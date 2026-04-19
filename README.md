# AI Gateway Platform — بوابة الذكاء الاصطناعي

بوابة AI وسيطة (SaaS) مبنية كـ pnpm monorepo بـ TypeScript — تُوكِّل طلبات المطورين إلى **Google Vertex AI** (Gemini 2.5 / 3.x / Imagen / Veo) وشركاء (Grok, DeepSeek, Kimi, MiniMax, Gemma, GLM-5, Mistral) عبر مفتاح API واحد، مع فوترة تلقائية بمعامل **1.1×** على أسعار Vertex AI الرسمية.

> **25 نموذج حي** + 19 نموذج قادم (Coming Soon)
>
> 🆕 **نظام رصيد مزدوج** — رصيد اشتراك (مقيَّد بنماذج الخطة) + رصيد إضافي (يعمل على كل النماذج).

---

## الميزات الرئيسية

| الميزة | التفاصيل |
|--------|---------|
| **وكيل API موحَّد** | `/v1/chat/completions` · `/v1/responses` · `/v1/generate` · `/v1/video` · SSE Streaming |
| **25 نموذج حي** | Gemini 2.5 + 3.x + Imagen + Veo + Grok + DeepSeek + Kimi + MiniMax + Gemma + GLM-5 + Mistral |
| **فوترة تلقائية** | 1.1× markup، حساب دقيق per-token/image/second، DB cache 5 min |
| **نظام رصيد مزدوج** | رصيد اشتراك (مقيَّد بخطة) + رصيد إضافي (مفتوح لكل النماذج، لا ينتهي). الخصم تلقائي: اشتراك أولاً ثم إضافي للنماذج داخل الخطة، وإضافي فقط للنماذج خارج الخطة |
| **إدارة مفاتيح API** | AES-256-GCM تشفير + HMAC-SHA256 hash للبحث + تدوير مع مهلة 24 ساعة |
| **التحقّق الثنائي (2FA)** | TOTP عبر Google Authenticator / 1Password / Authy — مدعوم في حسابات المسؤول وحسابات المطوّر معًا، مع QR Code وحدّ معدّل صارم |
| **Webhooks موقَّعة** | HMAC-SHA256 على كل بايلود (`X-Signature` + `X-Timestamp`)، مع تدوير السرّ وقت الحاجة |
| **Idempotency Keys** | رأس `Idempotency-Key` على `/v1/*` يُمنع التكرار خلال 24 ساعة (لا يطبَّق على البث SSE) |
| **GDPR Export** | تنزيل ZIP لكامل بيانات الحساب من صفحة الإعدادات |
| **نظام الخطط** | monthly credits · RPM per plan · نماذج مسموح بها |
| **Rate Limiting** | Token Bucket (DB-backed per user) + IP rate limiter |
| **حماية المحتوى** | 4 طبقات: Vertex safety + system prompt injection + keyword blacklist (AR+EN) + auto-suspend |
| **بوابة المطورين** | تسجيل ذاتي، توثيق تفاعلي، إدارة مفاتيح، عرض الاستخدام |
| **لوحة أدمن كاملة** | Developers · Plans · Pricing · Providers · Analytics · Audit Log · Promo Codes |
| **i18n كامل** | عربي (RTL) + إنجليزي مع تبديل فوري |
| **رموز ترويجية** | Promo Codes بقيمة ثابتة أو نسبة مئوية مع حد للاستخدام |
| **شحن الرصيد (Chargily Pay V2)** | بوابة دفع جزائرية DZD→USD، HMAC-verified webhook، CAS idempotent (لا تكرار حتى مع الإعادات) |
| **برنامج الإحالة** | عمولة 8% (قابلة للتعديل) محسوبة على **المبلغ المدفوع فعلياً** لا على الرصيد الممنوح. حجز 14 يوماً، حد أدنى للسحب $10، استرداد تلقائي عند refund/dispute مع clawback، لوحات تحكم منفصلة للمطوّر والإدمن |

---

## البنية التقنية

```
┌─────────────────────────────────────────────────────────────┐
│              Developer / Client (curl · SDK · n8n)           │
└──────────────────────┬──────────────────────────────────────┘
                       │  Bearer API Key
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  API Server  (Express 5, Node 24)            │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  API Key Auth │  │  Rate Limiter  │  │  Credit Check    │  │
│  └──────────────┘  └───────────────┘  └──────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Content Guardrails (4 layers)                       │    │
│  │  Vertex Safety · System Prompt · Keyword · Suspend   │    │
│  └──────────────────────────────────────────────────────┘    │
│         /v1/chat  /v1/images  /v1/videos  /v1/models         │
│         /api/admin/*                /api/portal/*            │
└───────────────┬─────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
        ▼                ▼
┌──────────────┐  ┌──────────────────────────────┐
│ Google Cloud │  │      PostgreSQL (Neon)         │
│ Vertex AI    │  │  users · api_keys · plans      │
│ + MaaS       │  │  usage_logs · model_costs      │
│ Providers    │  │  audit_logs · promo_codes      │
└──────────────┘  │  providers · violation_logs   │
                  └──────────────────────────────┘
```

---

## Stack التقني

| الطبقة | التقنية |
|--------|---------|
| Runtime | Node.js 24 |
| Package manager | pnpm workspaces (monorepo) |
| Language | TypeScript 5.9 |
| API framework | Express 5 |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Validation | Zod v4 + drizzle-zod |
| API codegen | Orval (OpenAPI → `lib/api-client-react` React hooks) |
| Build | esbuild (api-server), Vite (dashboard) |
| Frontend | React 19 · wouter · TanStack Query v5 · shadcn/ui · recharts |
| Auth | JWT (localStorage) + scrypt N=16384 + TOTP 2FA (otplib + qrcode) |
| Encryption | AES-256-GCM (API key storage + 2FA secrets) + HMAC-SHA256 (lookup + webhook signing) |
| Logging | pino + pino-http |
| Testing | Vitest — 193 tests · 17 test files (billing, crypto, auth, admin, portal, v1) |
| i18n | react-i18next (العربية + English) |

---

## النماذج المدعومة

### 🟢 23 نموذج حي

#### Google — Gemini 2.5
| Model ID | النوع | السعر (in/out per 1M) |
|----------|-------|----------------------|
| `gemini-2.5-pro` | Text | $1.25 / $10.00 |
| `gemini-2.5-flash` | Text | $0.30 / $2.50 |
| `gemini-2.5-flash-lite` | Text | $0.10 / $0.40 |

#### Google — Gemini 3.1
| Model ID | النوع | السعر |
|----------|-------|-------|
| `gemini-3.1-pro-preview` | Text | $2.00 / $12.00 |
| `gemini-3.1-flash-lite-preview` | Text | $0.25 / $1.50 |
| `gemini-3.1-flash-image-preview` | Text | $0.50 / $3.00 |

#### Google — Gemini 3.0
| Model ID | النوع | السعر |
|----------|-------|-------|
| `gemini-3.0-pro-preview` | Text | $2.00 / $12.00 |
| `gemini-3.0-flash-preview` | Text | $0.50 / $3.00 |
| `gemini-3.0-pro-image-preview` | Text | $2.00 / $12.00 |

#### Google — Imagen (صور)
`imagen-4.0-generate-001` ($0.04/img) · `imagen-4.0-ultra-generate-001` ($0.06/img)
`imagen-3.0-generate-002` ($0.04/img) · `imagen-3.0-fast-generate-001` ($0.02/img)

#### Google — Veo (فيديو)
`veo-3.1-generate-001` ($0.40/s) · `veo-3.1-fast-generate-001` ($0.12/s)
`veo-3.0-generate-001` ($0.40/s) · `veo-2.0-generate-001` ($0.50/s)

#### شركاء (Partners)
| المزوِّد | Model | السعر (in/out per 1M) |
|---------|-------|----------------------|
| xAI | `grok-4.20` | $0.20 / $0.50 |
| xAI | `grok-4.1-thinking` | $0.20 / $0.50 |
| DeepSeek | `deepseek-v3.2` | $0.56 / $1.68 |
| Google | `gemma-4-26b` | $0.20 / $0.80 |
| Kimi | `kimi-k2` | $0.60 / $2.50 |
| MiniMax | `minimax-m2` | $0.30 / $1.20 |

> الأسعار أعلاه هي الأسعار الأساسية (base). يُطبَّق معامل **1.1×** على المستخدم النهائي.

### 🔜 19 نموذج قادم (Coming Soon)
Grok 4.1 Fast · Mistral (7 نماذج: Codestral 2, Large 3, Medium 3, Small, Ministral 3B, Codestral, Jamba Large) · DeepSeek R1 (4 نماذج: R1-0529, R1-0528, R1, OCR) · GLM-5 / GLM-5.1 · Llama 4 Maverick / Scout / 3.3 70B · GPT-OSS 120B · Qwen3 235B

---

## نقاط API

### Base URL
```
https://your-domain.replit.app
```

### المصادقة
```http
Authorization: Bearer sk-xxxxxxxxxxxxxxxxxxxx
```

### POST /v1/chat/completions — نص (OpenAI-compatible)
```json
{
  "model": "gemini-2.5-flash",
  "messages": [{"role": "user", "content": "مرحباً!"}],
  "temperature": 0.7,
  "stream": true
}
```

**الاستجابة:**
```json
{
  "id": "req_abc123",
  "model": "gemini-2.5-flash",
  "content": "مرحباً! كيف يمكنني مساعدتك؟",
  "inputTokens": 5,
  "outputTokens": 9,
  "costUsd": 0.0000015
}
```

### POST /v1/images/generations — صور (Imagen)
```json
{
  "model": "imagen-4.0-generate-001",
  "prompt": "منظر طبيعي خلاب عند الغروب",
  "n": 1
}
```

### POST /v1/videos/generations — فيديو (Veo)
```json
{
  "model": "veo-3.0-generate-001",
  "prompt": "موجة بحرية بطيئة تتكسر على الشاطئ",
  "durationSeconds": 5
}
```

### GET /v1/models — قائمة النماذج
```bash
curl -H "Authorization: Bearer sk-xxx" https://your-domain.replit.app/v1/models
```

---

## هيكل المشروع

```
/
├── artifacts/
│   ├── api-server/              # Express 5 Backend
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── admin/       # auth · plans · users · analytics · modelCosts · auditLog · promoCodes
│   │       │   ├── portal/      # auth · me · usage · promoCodes
│   │       │   └── v1/          # chat · images · videos · models
│   │       └── lib/
│   │           ├── billing.ts   # calculateChatCost / calculateImageCost / calculateVideoCost
│   │           ├── guardrails.ts # 4-layer content safety
│   │           ├── rateLimit.ts  # Token Bucket (DB-backed)
│   │           ├── vertexai.ts          # Re-export barrel (5 sub-modules)
│   │           ├── vertexai-gemini.ts   # Gemini chat (streaming + REST)
│   │           ├── vertexai-compat.ts   # OpenAI-compat (Grok, DeepSeek, Kimi…)
│   │           ├── vertexai-imagen.ts   # Imagen image generation
│   │           ├── vertexai-veo.ts      # Veo video generation + polling
│   │           ├── vertexai-provider.ts # Provider resolution + token helper
│   │           └── chatUtils.ts         # stripThinkTags · ThinkTagFilter · deductAndLog
│   │
│   └── dashboard/               # React + Vite
│       └── src/
│           ├── pages/
│           │   ├── admin/        # Dashboard · Developers · Plans · Pricing · Providers
│           │   │                 # Analytics · AuditLog · PromoCodes
│           │   └── portal/       # Dashboard · ApiKeys · Plans · Usage · Docs · Settings
│           ├── lib/
│           │   └── models.ts     # MODELS[] — 42 نموذج (23 حي + 19 coming soon)
│           └── i18n/             # en.json · ar.json
│
└── lib/
    ├── db/                       # Drizzle ORM — 11 جدول
    ├── api-zod/                  # Zod schemas (OpenAPI)
    └── api-client-react/         # Generated React Query hooks (Orval)
```

---

## قاعدة البيانات (19 جدول)

| الجدول | الغرض |
|--------|-------|
| `users` | مصادقة · أدوار · **رصيدان (اشتراك + إضافي)** · تحقق البريد · `referral_code` · `referred_by` |
| `webhooks` | webhooks الخاصة بالمستخدم مع HMAC-SHA256 secret |
| `api_keys` | مفاتيح مرتبطة بالمستخدمين/الخطط، مشفرة |
| `plans` | خطط الاشتراك: credits · RPM · نماذج مسموح بها |
| `usage_logs` | سجل طلبات غير قابل للتعديل |
| `providers` | حسابات Google Cloud + service account مشفرة |
| `model_costs` | أسعار النماذج (DB override) |
| `rate_limit_buckets` | Token Bucket per user |
| `ip_rate_limits` | IP rate limiter |
| `audit_logs` | سجل عمليات الأدمن |
| `promo_codes` | رموز ترويجية |
| `violation_logs` | سجل انتهاكات المحتوى |
| `payment_intents` | عمليات شحن Chargily Pay V2 (DZD→USD، الحالة pending/paid/failed/refunded) |
| `chargily_webhook_events` | سجل أحداث webhook (UNIQUE eventId — حماية من إعادة التشغيل) |
| `referral_earnings` | عمولات الإحالة. UNIQUE(`source_type`, `source_id`) لمنع التكرار. الحالات: pending → available → redeemed (أو reversed عند الاسترداد). الأساس = **المبلغ المدفوع فعلياً**، لا قيمة الرصيد الممنوح |
| `incidents` · `health_snapshots` | صفحة الحالة (incidents + uptime) |
| `organizations` · `organization_members` · `organization_invites` | فرق العمل والأعضاء والدعوات |

---

## الأمان

| الطبقة | التقنية |
|--------|---------|
| كلمات المرور | scrypt N=16384 + salt + `timingSafeEqual` |
| مفاتيح API | HMAC-SHA256 للبحث + AES-256-GCM للعرض + تدوير بمهلة 24 ساعة |
| التحقّق الثنائي 2FA | TOTP (RFC 6238) — متاح للمسؤول وللمطوّر، السرّ مشفّر AES-256-GCM، حدّ معدّل 30 محاولة/15 دقيقة لكل IP |
| JWT | localStorage · 7 أيام |
| Webhooks | HMAC-SHA256 على البايلود + ختم زمني، السرّ قابل للتدوير |
| Idempotency | تخزين الاستجابة 24 ساعة لكل `(apiKeyId, Idempotency-Key)` — تخطّي تلقائي للبث SSE |
| CSP | تفعيل كامل لسياسة أمان المحتوى مع السماح بـ YouTube embeds |
| Crash reporting | Sentry (مفعَّل عند توفّر `SENTRY_DSN`) |
| Content Safety | Vertex + System Prompt + Keyword Blacklist (AR+EN) + Auto-Suspend |

---

## التشغيل المحلي

```bash
# 1. تثبيت الاعتمادات
pnpm install

# 2. متغيرات البيئة المطلوبة
#    DATABASE_URL · JWT_SECRET · ENCRYPTION_KEY
#    ADMIN_EMAIL · ADMIN_PASSWORD
#    SMTP_HOST · SMTP_PORT · SMTP_USER · SMTP_PASS

# 3. تهيئة قاعدة البيانات
pnpm --filter db push

# 4. تشغيل API Server
pnpm --filter @workspace/api-server run dev

# 5. تشغيل Dashboard (نافذة منفصلة)
pnpm --filter @workspace/dashboard run dev
```

---

## النشر (Deployment)

```bash
# 1. بناء المشروع
pnpm run build

# 2. تشغيل API Server (PORT مطلوب)
PORT=8081 pnpm --filter @workspace/api-server run start
```

---

## الترخيص

هذا المشروع خاص — جميع الحقوق محفوظة.
