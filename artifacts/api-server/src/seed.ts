import { db, plansTable, usersTable, modelCostsTable } from "@workspace/db";
import { MODEL_COSTS } from "./lib/billing";
import { hashPassword } from "./lib/crypto";
import { logger } from "./lib/logger";
import { eq, notInArray, sql } from "drizzle-orm";

// ─── Gemini 2.5 ────────────────────────────────────────────────────────────
const GEMINI_25_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

// ─── Gemini 3.1 ────────────────────────────────────────────────────────────
const GEMINI_31_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-flash-image-preview",
];

// ─── Gemini 3.0 (correct Resource IDs per Google docs — no ".0" in name) ───
// Note: gemini-3-pro-preview removed — GCP project has no access (returns 404)
const GEMINI_30_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
];

// ─── Imagen ────────────────────────────────────────────────────────────────
const IMAGEN_MODELS = [
  "imagen-4.0-generate-001",
  "imagen-4.0-ultra-generate-001",
  "imagen-3.0-generate-002",
  "imagen-3.0-fast-generate-001",
];

// ─── Veo ───────────────────────────────────────────────────────────────────
const VEO_MODELS = [
  "veo-3.1-generate-001",
  "veo-3.1-fast-generate-001",
  "veo-3.0-generate-001",
  "veo-2.0-generate-001",
];

// ─── Grok / xAI ────────────────────────────────────────────────────────────
const GROK_MODELS = [
  "grok-4.20",
  "grok-4.1-thinking",
];

// ─── DeepSeek ──────────────────────────────────────────────────────────────
const DEEPSEEK_MODELS = [
  "deepseek-v3.2",
];

// ─── Google Gemma MaaS ─────────────────────────────────────────────────────
const GEMMA_MODELS = [
  "gemma-4-26b",
];

// ─── Kimi / Moonshot AI ────────────────────────────────────────────────────
const KIMI_MODELS = [
  "kimi-k2",
];

// ─── MiniMax ───────────────────────────────────────────────────────────────
const MINIMAX_MODELS = [
  "minimax-m2",
];

// ─── Zhipu AI GLM-5 (via Vertex AI MaaS — publisher: zai-org) ──────────────
const GLM_MODELS = [
  "glm-5",
];

// ─── Mistral AI (via Vertex AI MaaS — publisher: mistral-ai) ────────────────
const MISTRAL_MODELS = [
  "mistral-small",   // Mistral Small 3.1 (25.03)
];

// ─── Imagen Capability (inpainting/edits) ──────────────────────────────────
const IMAGEN_EDIT_MODELS = [
  "imagen-3.0-capability-001",
];

// ─── Audio (TTS + STT via Google Cloud) ────────────────────────────────────
const AUDIO_MODELS = [
  "tts-1",
  "tts-1-hd",
  "whisper-1",
];

const ALL_MODELS = [
  ...GEMINI_25_MODELS,
  ...GEMINI_31_MODELS,
  ...GEMINI_30_MODELS,
  ...IMAGEN_MODELS,
  ...IMAGEN_EDIT_MODELS,
  ...VEO_MODELS,
  ...GROK_MODELS,
  ...DEEPSEEK_MODELS,
  ...GEMMA_MODELS,
  ...KIMI_MODELS,
  ...MINIMAX_MODELS,
  ...GLM_MODELS,
  ...MISTRAL_MODELS,
  ...AUDIO_MODELS,
];

const FREE_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
];

const PRO_MODELS = [
  // Gemini 2.5
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  // Gemini 3.0
  "gemini-3-flash-preview",
  // Imagen
  "imagen-3.0-fast-generate-001",
  "imagen-3.0-generate-002",
  "imagen-4.0-generate-001",
  // Grok
  "grok-4.20",
  "grok-4.1-thinking",
  // DeepSeek
  "deepseek-v3.2",
  // Gemma
  "gemma-4-26b",
  // MiniMax
  "minimax-m2",
  // Kimi
  "kimi-k2",
  // Zhipu AI
  "glm-5",
  // Mistral AI
  "mistral-small",
  // Imagen edits/inpainting
  "imagen-3.0-capability-001",
  // Audio
  "tts-1",
  "tts-1-hd",
  "whisper-1",
];

export async function runSeed(): Promise<void> {
  logger.info("Starting database seed...");

  const PLAN_DEFAULTS = [
    {
      name: "Free",
      description: "Free tier — perfect for testing. 6 models, 10 RPM.",
      monthlyCredits: 5,
      rpm: 10,
      modelsAllowed: FREE_MODELS,
      priceUsd: 0,
      isActive: true,
    },
    {
      name: "Pro",
      description: "Professional tier — Gemini 3.x, Grok, Mistral, DeepSeek, Llama, Qwen + image generation. 60 RPM.",
      monthlyCredits: 50,
      rpm: 60,
      modelsAllowed: PRO_MODELS,
      priceUsd: 29,
      isActive: true,
    },
    {
      name: "Enterprise",
      description: "Enterprise tier — all models including Gemini 3.1, Grok 4.20, Veo video, MiniMax M2 and more. 300 RPM.",
      monthlyCredits: 500,
      rpm: 300,
      modelsAllowed: ALL_MODELS,
      priceUsd: 199,
      isActive: true,
    },
  ];

  const existingPlans = await db
    .select({ id: plansTable.id, name: plansTable.name })
    .from(plansTable);

  if (existingPlans.length === 0) {
    await db.insert(plansTable).values(PLAN_DEFAULTS);
    logger.info("Created 3 default plans");
  } else {
    for (const defaults of PLAN_DEFAULTS) {
      const match = existingPlans.find((p) => p.name === defaults.name);
      if (match) {
        await db
          .update(plansTable)
          .set({ modelsAllowed: defaults.modelsAllowed, description: defaults.description })
          .where(eq(plansTable.id, match.id));
        logger.info({ plan: defaults.name }, "Updated plan models");
      }
    }
  }

  const existingAnyAdmin = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .limit(1);

  if (existingAnyAdmin.length > 0) {
    await db
      .update(usersTable)
      .set({ emailVerified: true, isActive: true })
      .where(eq(usersTable.role, "admin"));
    logger.info("Admin account already exists — ensured emailVerified=true");
  } else {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      logger.warn(
        "No admin account found. Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables to create one on next startup."
      );
      return;
    }

    const passwordHash = await hashPassword(adminPassword);

    const existingUser = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, adminEmail))
      .limit(1);

    if (existingUser.length > 0) {
      await db
        .update(usersTable)
        .set({ role: "admin", passwordHash, isActive: true, emailVerified: true })
        .where(eq(usersTable.email, adminEmail));
      logger.info({ email: adminEmail }, "Promoted existing user to admin");
    } else {
      await db.insert(usersTable).values({
        email: adminEmail,
        passwordHash,
        name: "Platform Admin",
        role: "admin",
        isActive: true,
        emailVerified: true,
      });
      logger.info({ email: adminEmail }, "Created admin account");
    }
  }

  // Seed model costs — upsert all hardcoded prices into DB so admin can edit them
  const validModelIds = Object.keys(MODEL_COSTS);

  // Remove any model_costs rows that are no longer in the supported model list
  if (validModelIds.length > 0) {
    const deleted = await db
      .delete(modelCostsTable)
      .where(notInArray(modelCostsTable.model, validModelIds));
    const deletedCount = (deleted as unknown as { rowCount?: number }).rowCount ?? 0;
    if (deletedCount > 0) {
      logger.info({ count: deletedCount }, "Removed stale model cost entries");
    }
  }

  const modelCostEntries = validModelIds.map((model) => {
    const costs = MODEL_COSTS[model]!;
    return {
      model,
      inputPer1M: costs.inputPer1M,
      outputPer1M: costs.outputPer1M,
      perImage: costs.perImage ?? null,
      perSecond: costs.perSecond ?? null,
      isActive: true,
    };
  });

  for (const entry of modelCostEntries) {
    await db
      .insert(modelCostsTable)
      .values(entry)
      .onConflictDoUpdate({
        target: modelCostsTable.model,
        set: {
          inputPer1M: sql`excluded.input_per_1m`,
          outputPer1M: sql`excluded.output_per_1m`,
          perImage: sql`excluded.per_image`,
          perSecond: sql`excluded.per_second`,
          isActive: sql`excluded.is_active`,
        },
      });
  }
  logger.info({ count: modelCostEntries.length }, "Model costs seeded (upserted)");

  logger.info("Seed complete!");
}

if (process.argv[1]?.endsWith("seed.mjs") || process.argv[1]?.endsWith("seed.ts")) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, "Seed failed");
      process.exit(1);
    });
}
