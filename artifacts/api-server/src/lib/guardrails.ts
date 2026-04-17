import { eq, sql } from "drizzle-orm";
import { db, usersTable, violationLogsTable } from "@workspace/db";
import type { ChatMessage } from "./vertexai";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_WARNINGS_BEFORE_SUSPEND = 3;
const MAX_LOGGED_CONTENT_LENGTH = 8000;

// ─── Layer 2: Safety System Prompt ───────────────────────────────────────────

const SAFETY_SYSTEM_PROMPT = `You are a helpful, honest, and safe AI assistant. You must strictly follow these rules:
1. Never provide instructions for creating malware, viruses, ransomware, keyloggers, or any harmful software.
2. Never assist with hacking, unauthorized system access, or cyberattacks.
3. Never generate sexual content involving minors (CSAM) under any circumstances.
4. Never provide instructions for creating weapons, explosives, or dangerous substances.
5. Never assist with terrorism, violent extremism, or incitement to violence.
6. Never help with fraud, scams, identity theft, or financial crimes.
7. If asked to do any of the above, politely refuse and explain you cannot assist with that request.
You may discuss these topics in an educational or awareness context, but never provide actionable harmful instructions.`;

const SAFETY_SYSTEM_ACK = "Understood. I am a safe AI assistant and I will strictly follow all the safety guidelines provided. I will refuse any requests that violate these rules.";

/**
 * Layer 2: Injects a hidden safety system prompt at the start of every conversation.
 * Uses a user/model turn pair so it works across all providers (Gemini, Claude, OpenAI-compat).
 */
export function injectSafetyPrompt(messages: ChatMessage[]): ChatMessage[] {
  return [
    { role: "user", content: `[SYSTEM SAFETY INSTRUCTIONS]\n${SAFETY_SYSTEM_PROMPT}` },
    { role: "model", content: SAFETY_SYSTEM_ACK },
    ...messages,
  ];
}

// ─── Layer 3: Keyword Blacklist ───────────────────────────────────────────────

interface BlockedPattern {
  pattern: RegExp;
  category: string;
}

const BLOCKED_PATTERNS: BlockedPattern[] = [
  // Malware & hacking (English)
  { pattern: /\b(create|write|make|build|develop|code)\b.{0,40}\b(malware|ransomware|keylogger|spyware|rootkit|trojan|botnet|worm|virus)\b/i, category: "malware_creation" },
  { pattern: /\b(hack into|exploit|brute.?force|sql injection|remote code execution|zero.?day exploit)\b/i, category: "cyberattack" },
  { pattern: /\b(ddos|denial.of.service) attack\b/i, category: "cyberattack" },
  { pattern: /\b(phishing (page|site|kit)|credential harvest)\b/i, category: "phishing" },
  // Malware & hacking (Arabic)
  { pattern: /\b(إنشاء|اكتب|برمج|طور|اصنع).{0,40}(فيروس|مالوير|برمجة خبيثة|برنامج تجسس|حصان طروادة|برنامج فدية)\b/i, category: "malware_creation" },
  { pattern: /\b(اختراق|قرصنة|تهكير).{0,30}(موقع|سيرفر|حساب|نظام|شبكة)\b/i, category: "cyberattack" },
  // CSAM (child sexual abuse material)
  { pattern: /\b(child|children|minor|kid|underage|infant).{0,20}(porn|sex|nude|naked|explicit|erotic|sexual)\b/i, category: "csam" },
  { pattern: /\b(csam|cp porn|lolita)\b/i, category: "csam" },
  { pattern: /\b(صور|محتوى|أفلام).{0,20}(أطفال).{0,20}(جنسي|إباحي|عاري)\b/i, category: "csam" },
  // Weapons & explosives
  { pattern: /\b(how to (make|build|create|synthesize)).{0,30}(bomb|explosive|c4|tnt|napalm|thermite)\b/i, category: "weapons" },
  { pattern: /\b(weapon|gun|firearm).{0,20}(undetectable|untraceable|ghost gun|convert to full.?auto)\b/i, category: "weapons" },
  { pattern: /\b(كيف.{0,10}(أصنع|أعمل|أبني)).{0,30}(قنبلة|متفجر|سلاح|مسدس غير مسجل)\b/i, category: "weapons" },
  // Drug synthesis
  { pattern: /\b(synthesize|manufacture|produce|make).{0,30}(methamphetamine|meth|fentanyl|heroin|cocaine|lsd|mdma)\b/i, category: "drug_synthesis" },
  { pattern: /\b(كيف.{0,10}(أصنع|أحضر|أنتج)).{0,30}(مخدرات|هيروين|كوكايين|ميثامفيتامين)\b/i, category: "drug_synthesis" },
  // Terrorism
  { pattern: /\b(how to (join|recruit for)|planning).{0,30}(terrorist|isis|isil|al.?qaeda|boko haram)\b/i, category: "terrorism" },
  { pattern: /\b(تجنيد|الانضمام|التخطيط).{0,30}(داعش|القاعدة|تنظيم إرهابي|عملية إرهابية)\b/i, category: "terrorism" },
  // Fraud & financial crime
  { pattern: /\b(create|make|generate).{0,20}(fake id|counterfeit|forged (passport|document|check))\b/i, category: "fraud" },
  { pattern: /\b(credit card (dump|skimmer|carding)|carding tutorial)\b/i, category: "fraud" },
  { pattern: /\b(إنشاء|عمل|تزوير).{0,20}(وثيقة مزيفة|جواز سفر مزور|هوية مزورة|شيك مزور)\b/i, category: "fraud" },
];

export interface ContentCheckResult {
  blocked: boolean;
  category?: string;
}

/**
 * Layer 3: Checks all messages against the keyword blacklist.
 * Returns immediately on first match without calling Vertex AI.
 */
function extractText(msg: ChatMessage): string {
  if (typeof msg.content === "string") return msg.content;
  return msg.content
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join(" ");
}

export function checkContent(messages: ChatMessage[]): ContentCheckResult {
  const fullText = messages.map(extractText).join("\n");
  for (const { pattern, category } of BLOCKED_PATTERNS) {
    if (pattern.test(fullText)) {
      return { blocked: true, category };
    }
  }
  return { blocked: false };
}

// ─── Layer 4: Violation Tracking, Evidence Logging & Auto-Suspend ─────────────

export interface ViolationContext {
  apiKeyId: number;
  requestId: string;
  model: string;
  messages: ChatMessage[];
  ip?: string;
}

export interface ViolationResult {
  suspended: boolean;
  warningNumber: number;
  message: string;
}

/**
 * Layer 4: Records a policy violation for a user.
 * - Saves the full request content to violation_logs as forensic evidence.
 * - First 2 violations: returns a warning message.
 * - 3rd violation and beyond: suspends the account.
 */
export async function recordViolation(
  userId: number,
  category: string,
  ctx: ViolationContext,
): Promise<ViolationResult> {
  const updated = await db
    .update(usersTable)
    .set({ guardrailViolations: sql`${usersTable.guardrailViolations} + 1` })
    .where(eq(usersTable.id, userId))
    .returning({ violations: usersTable.guardrailViolations });

  const violations = updated[0]?.violations ?? 1;
  const warningNumber = violations;
  const remaining = MAX_WARNINGS_BEFORE_SUSPEND - warningNumber;

  // Persist the full request as forensic evidence
  const messageContent = JSON.stringify(ctx.messages).slice(0, MAX_LOGGED_CONTENT_LENGTH);
  await db.insert(violationLogsTable).values({
    userId,
    apiKeyId: ctx.apiKeyId,
    requestId: ctx.requestId,
    model: ctx.model,
    violationCategory: category,
    violationNumber: warningNumber,
    messageContent,
    ipAddress: ctx.ip ?? null,
  }).catch(() => {});

  if (violations >= MAX_WARNINGS_BEFORE_SUSPEND) {
    await db
      .update(usersTable)
      .set({ guardrailSuspended: true, isActive: false })
      .where(eq(usersTable.id, userId));

    return {
      suspended: true,
      warningNumber,
      message:
        "🚫 تم إيقاف حسابك نهائياً بسبب تكرار انتهاك سياسات الاستخدام. " +
        "لن يتم استرداد أي رصيد متبقٍ. للاستفسار تواصل مع الدعم الفني. | " +
        "Your account has been permanently suspended due to repeated policy violations. " +
        "No remaining credits will be refunded. Please contact support.",
    };
  }

  return {
    suspended: false,
    warningNumber,
    message:
      `⚠️ تحذير (${warningNumber}/${MAX_WARNINGS_BEFORE_SUSPEND}): ` +
      `طلبك يخالف سياسات الاستخدام المقبول. ` +
      (remaining > 0
        ? `لديك ${remaining} تحذير${remaining === 1 ? "" : "ات"} متبقية قبل إيقاف حسابك نهائياً وفقدان رصيدك.`
        : "") +
      ` | Warning (${warningNumber}/${MAX_WARNINGS_BEFORE_SUSPEND}): ` +
      `Your request violates our Acceptable Use Policy. ` +
      (remaining > 0
        ? `You have ${remaining} warning${remaining === 1 ? "" : "s"} remaining before your account is permanently suspended and credits forfeited.`
        : ""),
  };
}

/**
 * Checks if the user's account is already suspended by guardrails.
 */
export async function isGuardrailSuspended(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ guardrailSuspended: usersTable.guardrailSuspended })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row?.guardrailSuspended ?? false;
}
