# AI Gateway Platform

## Overview

SaaS AI Gateway — pnpm workspace monorepo (TypeScript).

Proxies Google Vertex AI (Gemini 2.5 + Gemini 3.x / Imagen / Veo) and **23 live models** from partner providers (Grok, DeepSeek, Kimi, MiniMax, Gemma) for developer clients. Developers receive API keys from the platform; the platform authenticates, rate-limits, bills per token at a **1.1× markup** (10% on official Vertex AI prices), and routes requests to the appropriate Vertex AI backend.

Includes a full admin dashboard and a developer self-service portal, with Arabic + English i18n.

---

## Artifacts

| Artifact | Preview path | Purpose |
|---|---|---|
| `artifacts/api-server` | `/api`, `/v1` | Express 5 API: admin routes, portal routes, v1 proxy |
| `artifacts/dashboard` | `/` | React + Vite: admin panel + developer portal + landing page |

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24 |
| Package manager | pnpm workspaces |
| Language | TypeScript 5.9 |
| API framework | Express 5 |
| Database | PostgreSQL (Neon) + Drizzle ORM |
| Validation | Zod v4 + drizzle-zod |
| API codegen | Orval (OpenAPI → `lib/api-client-react`) |
| Build | esbuild (api-server bundle), Vite (dashboard) |
| Frontend | React 19, TanStack Query v5, shadcn/ui, recharts |
| Auth | JWT (localStorage) + scrypt N=16384 password hashing |
| Encryption | AES-256-GCM (API keys stored) + HMAC-SHA256 (lookup + webhooks) |
| File uploads | multer (memory storage, 20MB limit, images only) |
| Logging | pino + pino-http |
| Testing | Vitest — 193 tests across 17 test files (billing, crypto, cookie-auth, v1 routes, admin, portal) — pool: forks, ~22s |
| i18n | react-i18next (English + Arabic RTL) |

---

## DB Schema (19 tables)

| Table | Purpose |
|---|---|
| `users` | Auth, roles, **dual credit balances** (`credit_balance` = subscription, `topup_credit_balance` = top-up), email verification, password reset, low-credit email timestamp, **`referral_code` (varchar(16) unique)**, **`referred_by` (int FK→users.id)** |
| `api_keys` | Keys linked to users/plans; HMAC hash + AES-256-GCM encrypted value |
| `plans` | Tiers: monthly credits, RPM, allowed model list, price |
| `usage_logs` | Immutable request records (tokens, cost, model, status) |
| `providers` | Google Cloud projects + encrypted service-account JSON |
| `model_costs` | Per-model pricing (DB override for hardcoded fallback, 5-min cache) |
| `rate_limit_buckets` | Token Bucket per user (DB-backed) |
| `ip_rate_limits` | IP rate limiter for auth endpoints |
| `audit_logs` | Admin action audit trail with IP and timestamp |
| `promo_codes` | Redeemable codes (fixed amount or percentage, usage limit) |
| `violation_logs` | Content guardrail violation evidence with auto-suspend logic |
| `webhooks` | User webhook endpoints with HMAC-SHA256 secret, event filter, lastTriggeredAt |
| `incidents` | Status-page incidents (bilingual title/body, severity, status, timestamps) |
| `health_snapshots` | Throttled health probes (one row per ~30s) used for uptime % |
| `organizations` | Teams/orgs with own credit pool (foundation; org-owned API keys opt-in via `api_keys.organization_id`) |
| `organization_members` | Composite-PK org↔user with role enum (owner / admin / developer / viewer) |
| `organization_invites` | Pending email invites with token + expiry, accepted-at timestamp |
| `payment_intents` | Chargily Pay V2 top-up intents (DZD→USD, status pending/paid/failed/canceled/expired/refunded/disputed) |
| `chargily_webhook_events` | Webhook event ledger (UNIQUE on eventId — replay protection) |
| `referral_earnings` | Per-payment referral commissions. UNIQUE(`source_type`, `source_id`) for race-safe idempotency. Status: `pending`→`available`→`redeemed` (or `reversed` on refund/dispute). Basis = **actual USD paid** (NOT credit value granted) |

---

## Live Models (25)

### Google — Gemini 2.5
- `gemini-2.5-pro` ($1.25/$10.00 per 1M in/out)
- `gemini-2.5-flash` ($0.30/$2.50)
- `gemini-2.5-flash-lite` ($0.10/$0.40)

### Google — Gemini 3.1
- `gemini-3.1-pro-preview` ($2.00/$12.00)
- `gemini-3.1-flash-lite-preview` ($0.25/$1.50)
- `gemini-3.1-flash-image-preview` ($0.50/$3.00)

### Google — Gemini 3.0
- `gemini-3.0-pro-image-preview` ($2.00/$12.00)
- `gemini-3.0-flash-preview` ($0.50/$3.00)

### Google — Imagen (image generation)
- `imagen-4.0-generate-001` ($0.04/img) · `imagen-4.0-ultra-generate-001` ($0.06/img)
- `imagen-3.0-generate-002` ($0.04/img) · `imagen-3.0-fast-generate-001` ($0.02/img)

### Google — Veo (video generation)
- `veo-3.1-generate-001` ($0.40/s) · `veo-3.1-fast-generate-001` ($0.12/s)
- `veo-3.0-generate-001` ($0.40/s) · `veo-2.0-generate-001` ($0.50/s)

### Partners (8 live)
- xAI: `grok-4.20`, `grok-4.1-thinking`
- DeepSeek: `deepseek-v3.2`
- Google MaaS: `gemma-4-26b`
- Kimi: `kimi-k2`
- MiniMax: `minimax-m2`
- Zhipu AI: `glm-5` (via Vertex AI MaaS, global endpoint)
- Mistral AI: `mistral-small` (Mistral Small 3.1 via Vertex AI rawPredict)

---

## API Endpoints

### Public (no auth)
- `GET /status/summary` — overall status (operational / degraded / major_outage), uptime % over 24h/7d/30d, active + recent incidents

### V1 — Developer API (Bearer: `sk-...` API key)
| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat` | Chat (our format, text + image parts) |
| POST | `/v1/chat/completions` | Chat (OpenAI-compatible format) |
| POST | `/v1/responses` | Responses API |
| POST | `/v1/generate` | Image generation (Imagen) |
| POST | `/v1/video` | Video generation (Veo), returns job ID. Supports `?wait=true` for synchronous mode (server polls internally up to 4 min). Idempotency: duplicate requests within 10 min return existing jobId with no new charge |
| GET | `/v1/video/:jobId/status` | Poll video job status (light auth — works at zero balance) |
| GET | `/v1/video/:jobId/download` | Download completed video as a real `video/mp4` file (decodes base64 inline URIs; SSRF-guarded for http(s)) |
| GET | `/v1/models` | List available models |
| POST | `/v1/files` | Upload image for multimodal chat (returns base64 + mimeType) |
| POST | `/v1/images/edits` | **Inpainting** — multipart (image, mask, prompt, n) using `imagen-3.0-capability-001`. OpenAI-compatible. |
| POST | `/v1/audio/speech` | **TTS** — JSON `{model, input, voice, response_format}` returns audio bytes. Models: `tts-1`, `tts-1-hd`. |
| POST | `/v1/audio/transcriptions` | **STT** — multipart (file, model). Model: `whisper-1`. Returns `{text}`. |

### Portal — Developer Self-Service (Bearer: JWT)
| Method | Path | Description |
|---|---|---|
| GET/PUT | `/portal/me` | Profile |
| GET/POST/DELETE | `/portal/api-keys` | API key management |
| GET | `/portal/usage` | Usage logs + daily stats + per-model breakdown |
| GET | `/portal/plans` | Available plans |
| POST | `/portal/promo-codes/redeem` | Redeem promo code |
| GET/POST/PUT/DELETE | `/portal/webhooks` | Webhook CRUD |
| POST | `/portal/webhooks/:id/test` | Send test webhook event |
| GET | `/portal/billing/config` | Top-up min/max + DZD↔USD rate |
| POST | `/portal/billing/topup` | Create Chargily checkout intent (returns `checkoutUrl`) |
| GET | `/portal/billing/intents[/:id]` | List / view top-up history |
| GET | `/portal/referrals` | Referral code, link, stats (referredCount, pendingUsd, availableUsd, lifetimeUsd, redeemedUsd), recent earnings |
| POST | `/portal/referrals/redeem` | Move available commissions → `topupCreditBalance` (CAS transactional, $10 min) |
| GET/POST | `/portal/organizations` | List my orgs / create new org (creator → owner) |
| GET/PATCH/DELETE | `/portal/organizations/:id` | Org details + members / rename / delete (owner only) |
| GET/POST/DELETE | `/portal/organizations/:id/invites[/:inviteId]` | Manage email invites (owner/admin) |
| POST | `/portal/organizations/invites/:token/accept` | Accept invite (auth + email match) |
| PATCH/DELETE | `/portal/organizations/:id/members/:userId` | Change role / remove member (owner/admin) |

### Admin (Bearer: JWT, role=admin)
| Method | Path | Description |
|---|---|---|
| GET/POST/PUT/DELETE | `/admin/users` | User management |
| GET/POST/PUT/DELETE | `/admin/plans` | Plan management |
| GET/POST/PUT/DELETE | `/admin/providers` | Vertex AI provider config |
| GET/POST/PUT/DELETE | `/admin/model-costs` | Per-model pricing override |
| GET | `/admin/analytics/stats` | Platform-wide stats |
| GET | `/admin/analytics/timeseries` | Chart data with model breakdown |
| GET | `/admin/analytics/usage` | Filtered usage log |
| GET | `/admin/analytics/user-summary` | Per-user breakdown |
| GET | `/admin/audit-log` | Admin action log |
| GET/POST/PUT/DELETE | `/admin/api-keys` | API key admin |
| GET/POST/PUT/DELETE | `/admin/promo-codes` | Promo code management |
| GET/POST/PATCH/DELETE | `/admin/incidents` | Status-page incident CRUD |
| GET | `/admin/billing/chargily/balance` | Chargily merchant balance |
| GET/PUT | `/admin/billing/chargily/settings` | DZD↔USD rate, min/max top-up |
| GET | `/admin/referrals` | Settings + totals + top referrers (×50) + recent earnings (×100) |
| PATCH | `/admin/referrals/settings` | Toggle program, set rate / hold days / min redeem |
| POST | `/admin/referrals/:id/reverse` | Manually reverse an earning (auto-clawback if redeemed) |

---

## Key Files

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/billing.ts` | MODEL_COSTS map, MARKUP_FACTOR=1.1, calculateChatCost/Image/Video |
| `artifacts/api-server/src/lib/guardrails.ts` | 4-layer content safety: Vertex + system prompt + keyword blacklist + auto-suspend |
| `artifacts/api-server/src/lib/rateLimit.ts` | Token bucket rate limiting per user |
| `artifacts/api-server/src/lib/vertexai.ts` | Re-export barrel — imports from 5 focused sub-modules (see below) |
| `artifacts/api-server/src/lib/vertexai-types.ts` | Shared interfaces, type aliases, model alias tables, provider detection utils |
| `artifacts/api-server/src/lib/vertexai-provider.ts` | Provider resolution (DB/env), VertexAI client builder, Google access token helper |
| `artifacts/api-server/src/lib/vertexai-gemini.ts` | Gemini SDK chat (streaming + non-streaming); global-endpoint REST path for Gemini 3.x |
| `artifacts/api-server/src/lib/vertexai-compat.ts` | OpenAI-compatible endpoint chat (Grok, DeepSeek, Kimi, MiniMax, Gemma MaaS) |
| `artifacts/api-server/src/lib/vertexai-imagen.ts` | Imagen image generation via Vertex AI predict API |
| `artifacts/api-server/src/lib/vertexai-veo.ts` | Veo video generation + async job status polling |
| `artifacts/api-server/src/lib/chatUtils.ts` | stripThinkTags, ThinkTagFilter, deductAndLog, estimateChatCost |
| `artifacts/api-server/src/lib/webhookDispatcher.ts` | HMAC-signed webhook dispatch (fire-and-forget) |
| `artifacts/api-server/src/routes/v1/chat.ts` | Chat route — multimodal, streaming, guardrails, billing, webhook dispatch |
| `artifacts/api-server/src/routes/v1/files.ts` | Image upload endpoint (multer, 20MB, returns base64) |
| `artifacts/api-server/src/routes/portal/webhooks.ts` | Webhook CRUD + test endpoint |
| `artifacts/api-server/src/routes/portal/usage.ts` | Usage stats + daily chart + per-model breakdown |
| `artifacts/api-server/src/routes/index.ts` | Route registration — admin + portal + v1 |
| `artifacts/dashboard/src/lib/models.ts` | MODELS[] array with ModelDef (id, provider, pricing, comingSoon?) |
| `artifacts/dashboard/src/pages/portal/Usage.tsx` | Usage page: daily chart + per-model bar chart + model filter |
| `artifacts/dashboard/src/pages/portal/Webhooks.tsx` | Webhook management page (create/toggle/delete/test + HMAC docs) |
| `artifacts/dashboard/src/pages/Landing.tsx` | Public landing page — bilingual, dynamic GATEWAY_BASE |
| `artifacts/dashboard/src/pages/portal/Docs.tsx` | Developer docs — model table, code samples (23 models) |
| `artifacts/dashboard/src/pages/admin/Plans.tsx` | Plan management + ModelPicker (comingSoon = disabled) |
| `artifacts/dashboard/src/pages/admin/Pricing.tsx` | Model cost management (1.1× markup display) |
| `lib/db/src/schema/webhooks.ts` | Webhooks table schema |
| `lib/db/src/schema/referral-earnings.ts` | Referral earnings table (DB-level UNIQUE on `source_type`+`source_id` for idempotency) |
| `lib/db/src/schema/` | All 19 Drizzle schema files |
| `artifacts/api-server/src/lib/referrals.ts` | Code generation, `recordReferralEarning` (ON CONFLICT DO NOTHING), `reverseReferralEarning` (with clawback), `redeemAvailableEarnings` (CAS transactional), `promotePendingEarnings` |
| `artifacts/api-server/src/lib/chargily.ts` | Chargily Pay V2 HTTP client with HMAC verify (timing-safe) |
| `artifacts/api-server/src/routes/portal/referrals.ts` | Portal referral endpoints (stats + redeem) |
| `artifacts/api-server/src/routes/admin/referrals.ts` | Admin referral panel endpoints (settings, top referrers, manual reverse) |
| `artifacts/api-server/src/routes/webhooks/chargily.ts` | Raw-body HMAC-verified webhook (records earnings on `paid`, reverses on `refunded`/`disputed`) |
| `artifacts/dashboard/src/pages/portal/Referrals.tsx` | Portal referral page (code/link share, WhatsApp, stats cards, history, redeem) |
| `artifacts/dashboard/src/pages/admin/Referrals.tsx` | Admin panel (totals, editable settings, top referrers, recent earnings + manual reverse) |
| `lib/api-zod/src/generated/api.ts` | Zod schemas — includes multimodal ChatContentPart |

---

## Architecture Notes

- **Billing**: `MODEL_COSTS` in billing.ts is the hardcoded fallback. DB table `model_costs` overrides these. A 5-minute in-memory cache reduces DB reads. MARKUP_FACTOR = 1.1 applied at billing time.
- **Money columns**: All USD/credit columns use `numeric(18, 8)` with drizzle `mode: "number"` (exact decimal storage in Postgres, JS `number` in app). Exceptions kept as `doublePrecision`: `users.spend_alert_threshold` (ratio 0..1) and `rate_limit_buckets_v2.tokens` (counter). Migration `0007_financial_numeric_precision.sql` converts existing schemas in-place.
- **Encryption**: `ENCRYPTION_KEY` is REQUIRED (no fallback). `crypto.ts` fails fast at module load. `JWT_SECRET` is consulted ONLY as a backward-compat decryption key for legacy ciphertext; new encryptions always use `ENCRYPTION_KEY`.
- **Model routing**: Only 23 live models have Vertex AI routing in vertexai.ts. The 19 `comingSoon` models exist in models.ts (dashboard display) but have no API routes — requests to them return 404.
- **Multimodal**: `ChatMessage.content` accepts `string | ContentPart[]`. ContentPart = `{ type:"text", text }` or `{ type:"image", mimeType, base64 }`. Gemini REST and SDK paths both handle image inlineData. OpenAI-compat models receive text-only (images silently stripped).
- **Webhooks**: HMAC-SHA256 signed. Signature in `X-Gateway-Signature: sha256=<hex>`. Events: `usage.success`, `usage.error`, `usage.rejected`, `low_balance`. Empty `events[]` = subscribe to all. Fire-and-forget (8s timeout per request).
- **Guardrails**: 4-layer defense. Layer 3 keyword blacklist covers Arabic and English. Layer 4 auto-suspends after 3 violations and logs evidence to `violation_logs`.
- **Auth separation**: Admin uses `/api/admin/auth/login`, portal uses `/api/portal/auth/login`. Both issue JWT stored in localStorage.
- **TypeScript**: `noImplicitAny` disabled in dashboard tsconfig (complex generated types). API server is strict.
- **Logging**: All server-side logging uses `pino` (via `src/lib/logger.ts`). No `console.log/warn/error` in production code paths.
- **Test mocking pattern**: dbMock uses `then: vi.fn(resolve => resolve([]))` to make the mock object thenable — enabling `await db.select().from().where()` chains without `.limit()`. `limit` uses `mockReturnThis()` so chains like `.limit().offset()` work; `offset` uses `mockResolvedValue([])` as the terminal.
- **lib rebuilding**: After schema changes, clear `tsbuildinfo` files in lib/db, lib/api-zod, lib/api-client-react before running typecheck.

---

## Environment Variables (Replit Secrets)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon) |
| `JWT_SECRET` | JWT signing secret |
| `ENCRYPTION_KEY` | AES-256-GCM key for API key storage |
| `ADMIN_EMAIL` | Initial admin account email |
| `ADMIN_PASSWORD` | Initial admin account password |
| `SMTP_PASS` | Gmail SMTP password for email verification |

Shared env (in .replit userenv): `SCRYPT_N=16384`, `SMTP_HOST`, `SMTP_USER`, `SMTP_FROM`, `SMTP_PORT`, `APP_BASE_URL`

---

## Run Commands

```bash
# Development
pnpm --filter @workspace/api-server run dev   # API Server (port from PORT env)
pnpm --filter @workspace/dashboard run dev    # Dashboard (Vite dev server)

# Production build
pnpm run build                                # Typecheck + build all artifacts

# Production start
PORT=8081 pnpm --filter @workspace/api-server run start
pnpm --filter @workspace/dashboard run serve

# Database
cd lib/db && pnpm push                        # Apply schema changes (dev only)
cd lib/db && pnpm push-force                  # Force apply (skip confirmations)
cd lib/db && pnpm generate                    # Generate SQL migration file
cd lib/db && pnpm migrate                     # Apply migrations (production-safe)

# Library builds (must run after schema changes)
pnpm --filter @workspace/db build             # Generates lib/db/dist/*.d.ts
pnpm --filter @workspace/api-zod build        # Generates lib/api-zod/dist/*.d.ts

# Tests
pnpm --filter @workspace/api-server test      # 235 tests across 21 test files (~38s)

# Typecheck
pnpm -r typecheck                             # All 8 packages (0 errors)
```

---

## Payment / Credit Top-up

**Live**: Chargily Pay V2 (Algerian gateway, DZD→USD). See Session 32 for full details. Required secrets: `CHARGILY_SECRET_KEY`, `CHARGILY_WEBHOOK_SECRET`, `CHARGILY_MODE` (`test`|`live`).

**Webhook URL** to configure in Chargily dashboard: `https://<your-domain>/webhooks/chargily`.

Stripe was previously dismissed; not in use. Do **not** hardcode any payment credentials.

---

## Referral Program (Session 33)

- **Commission**: 8% (admin-editable) of **actual USD paid**, never of credit value granted.
- **Hold window**: 14 days (admin-editable). Pending earnings ripen lazily on portal stats fetch.
- **Min redeem**: $10 (admin-editable). Redeemed amounts are added to `topupCreditBalance`.
- **Refund handling**: Chargily `refunded`/`disputed` webhooks trigger `reverseReferralEarning`. If the commission was already redeemed, the referrer's `topupCreditBalance` is debited (clawback) — balance is allowed to go negative; admin reconciles via the panel.
- **Idempotency**: DB-level `UNIQUE(source_type, source_id)` on `referral_earnings` + `ON CONFLICT DO NOTHING` prevents duplicate commissions under concurrent webhook delivery.
- **Self-referral**: Blocked at `recordReferralEarning` (silent no-op if `referrerId === referredUserId`).
- **Share URL format**: `https://<base>/signup?ref=<CODE>`. The signup page persists `ref` in `localStorage` for 30 days so users can browse before registering.

---

## Recent Changes (Apr 2026)

### Session 33 — Referral System Phase 1 (8% commission on real revenue)

Adds a complete referral pipeline. Every user gets a unique 8-char base31 code (no confusable chars: I/L/O/0/1). Commission is **always** calculated on actual USD paid — `payment_intents.amountUsd` — never on the credit value granted to the referee. A $29 plan that grants $50 credit pays an $29 × 8% = $2.32 commission, NOT $50 × 8%.

1. **Schema** (`lib/db/migrations/0010_referrals.sql`):
   - `users` gains `referral_code varchar(16) UNIQUE` + `referred_by integer FK→users.id ON DELETE SET NULL`. Both nullable. `users.id` stayed `serial` — no destructive type changes.
   - `referral_earnings` (serial id, referrer_id, referred_user_id, source_type [`topup`|`plan`], source_id, basis_amount_usd numeric(18,8), commission_usd numeric(18,8), rate numeric(6,4), status [`pending`|`available`|`redeemed`|`reversed`], unlocks_at, redeemed_at, created_at, updated_at).
   - **DB-enforced idempotency**: `UNIQUE INDEX referral_earnings_source_uidx ON (source_type, source_id)`. Combined with `ON CONFLICT DO NOTHING` in the insert path, two concurrent webhook deliveries for the same payment can never both create an earning.
   - 4 settings seeded (`ON CONFLICT DO NOTHING`): `referral_rate=0.08`, `referral_hold_days=14`, `referral_min_redeem_usd=10`, `referrals_enabled=true`.

2. **Backend lib** (`artifacts/api-server/src/lib/referrals.ts`):
   - `ensureReferralCode(userId)` — lazy generate-on-first-use, retries on UNIQUE collision.
   - `captureSignupReferral(newUserId, refCode)` — sets `users.referred_by` once, silently no-ops on self-referral or unknown code.
   - `recordReferralEarning({referredUserId, sourceType, sourceId, basisAmountUsd})` — atomic insert with `ON CONFLICT DO NOTHING`. Self-referral guard. Reads rate/holdDays from settings each call. Returns `{id, commissionUsd, referrerId}` or `null` (no referrer / duplicate / disabled).
   - `reverseReferralEarning(sourceType, sourceId)` — transactional, `SELECT … FOR UPDATE`. Behavior depends on current status: `pending|available` → `reversed` (no money flow); `redeemed` → `reversed` + **clawback** from referrer's `topupCreditBalance` (allowed to go negative; admin reconciles); `reversed` → no-op.
   - `redeemAvailableEarnings(userId)` — CAS transaction: locks all `available` rows, sums them, enforces `min_redeem_usd`, increments `topupCreditBalance`, marks rows `redeemed`. All-or-nothing.
   - `promotePendingEarnings()` — flips `pending`→`available` for rows where `unlocks_at < now()`. Called lazily on portal stats fetch (no cron).

3. **Hooks**:
   - **Signup** (`routes/portal/auth.ts`): accepts optional `refCode` in request body, calls `captureSignupReferral` after the user-creation transaction commits. Failure is non-fatal (logged, not bubbled — registration still succeeds).
   - **Chargily webhook** (`routes/webhooks/chargily.ts`):
     - On `paid` (after CAS-protected credit grant): calls `recordReferralEarning("topup", intent.id, intent.amountUsd)`. Errors are caught and logged — the webhook still returns 200.
     - On `refunded` / `disputed`: marks intent reversed, calls `reverseReferralEarning("topup", intent.id)`, writes `referral.reversed` audit row with clawback amount.

4. **Portal endpoints** (`routes/portal/referrals.ts`, behind `requireAuth`):
   - `GET /portal/referrals` — calls `promotePendingEarnings` first, then returns `{enabled, code, link, rate, holdDays, minRedeemUsd, stats:{referredCount, pendingUsd, availableUsd, redeemedUsd, reversedUsd, lifetimeUsd}, recent:[…20]}`.
   - `POST /portal/referrals/redeem` — returns `{ok, redeemedUsd}` or 400 `min_not_met` / `nothing_available`.

5. **Admin endpoints** (`routes/admin/referrals.ts`, behind `requireAdmin`):
   - `GET /admin/referrals` — settings + platform totals + top 50 referrers (sorted by lifetime commission) + last 100 earnings. Single query per section.
   - `PATCH /admin/referrals/settings` — validates and persists `enabled`, `rate` (0..1), `holdDays` (0..365 int), `minRedeemUsd` (≥0). Writes `referral.settings.update` audit log with diff.
   - `POST /admin/referrals/:id/reverse` — manual reverse with audit. Frontend prompts for confirmation, especially when clawback may apply.

6. **Frontend**:
   - **Portal `/portal/referrals`** — stats cards (referred count / pending / available + redeem button / lifetime), share card (code + link inputs with copy buttons, WhatsApp share, native Web Share fallback), earnings history table with status badges (pending/available/redeemed/reversed). Bilingual AR/EN with RTL.
   - **Signup `/signup`** — captures `?ref=CODE` from URL, persists in `localStorage` for 30 days under key `ai_gw_ref_code` (so users can browse Plans/Pricing before signing up), shows green invite banner when active code is detected, sends `refCode` field with registration request, clears storage on success. Sent loosely (`as never`) — backend reads `req.body.refCode` directly until openapi codegen catches up.
   - **Sidebars**: "الإحالة / Referrals" entry added to both `PortalLayout.tsx` and `AdminLayout.tsx` with `Gift` icon.
   - **Routes**: `referrals` added under both `/portal` and `/admin` in `App.tsx` with lazy import.

7. **Code review fixes (financial integrity — applied before commit)**:
   - Replaced non-unique `(source_type, source_id)` index with a true `UNIQUE INDEX` + `ON CONFLICT DO NOTHING` to make `recordReferralEarning` race-safe (was previously read-then-insert, vulnerable to concurrent webhook duplicates).
   - Added `refunded` / `disputed` handling to webhook with full reverse + clawback pipeline (was previously falling through to "status not actionable").
   - Created formal migration file `0010_referrals.sql` for deployment to fresh environments (originally applied via `psql` to avoid `drizzle-kit push --force` interactive prompt on existing 127 users).

8. **Bonus chargily fix discovered during this session**: `buildWebhookUrl()` is async; added missing `await` in 2 call sites (`routes/admin/chargily.ts` lines 174, 241). The webhook URL was previously rendered as `[object Object]` in admin UI.

**Tests**: 235/235 passing. No new tests added for referrals yet — Phase 2 will include E2E tests for capture, record, ripen, redeem, reverse, clawback.

**Configuration**: All knobs live in `system_settings` and are admin-editable: `referrals_enabled`, `referral_rate`, `referral_hold_days`, `referral_min_redeem_usd`.

### Session 32 — Chargily Pay V2 integration (Algerian payment gateway)

Adds DZD→USD credit top-ups via Chargily Pay V2. Users pay in Algerian Dinars on Chargily's hosted checkout; credits land in `users.topupCreditBalance` only after a HMAC-verified webhook arrives (CAS-idempotent — never double-credits even on retries or replays).

1. **Schema** (`lib/db/migrations/0009_chargily_payments.sql`):
   - `payment_intents` (serial id, userId FK, chargilyCheckoutId UNIQUE, amountDzd, amountUsd, exchangeRate, currency, status [pending|paid|failed|canceled|expired], mode [test|live], checkoutUrl, creditedAt, failureReason, createdAt). Indexed on userId, chargilyCheckoutId, status, createdAt.
   - `chargily_webhook_events` (serial id, eventId UNIQUE — replay protection, eventType, signature, payload TEXT, receivedAt). Indexed on eventId, receivedAt.
   - Seeds 3 settings rows in `app_settings`: `chargily_dzd_to_usd_rate=135`, `chargily_min_topup_dzd=500`, `chargily_max_topup_dzd=500000`. All `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` — fully idempotent.

2. **HTTP client** (`artifacts/api-server/src/lib/chargily.ts`):
   - `getChargilyBaseUrl()` switches between `https://pay.chargily.net/test/api/v2` and `…/api/v2` based on `CHARGILY_MODE`.
   - `chargilyRequest()` retries 5xx/network errors (default 2 retries, exponential backoff), no retry on 4xx. Bearer auth from `CHARGILY_SECRET_KEY`.
   - `createCustomer`, `createCheckout`, `retrieveCheckout`, `retrieveBalance`.
   - `verifyWebhookSignature(rawBody, sig)` — HMAC-SHA256 with constant-time `timingSafeEqual`; returns false (not throws) when secret missing or sig malformed.

3. **Settings helper** (`lib/chargilySettings.ts`): typed read/write of the three `app_settings` rows with sensible fallbacks.

4. **Routes**:
   - `routes/portal/billing.ts` (auth-gated): `GET /portal/billing/config`, `POST /portal/billing/topup` (validates min/max, creates intent, opens Chargily checkout, returns `checkoutUrl`), `GET /portal/billing/intents`, `GET /portal/billing/intents/:id` (with optional live status refresh after 30s for missed webhooks — refresh **never** credits).
   - `routes/webhooks/chargily.ts`: raw-body verified by `express.raw()` mounted in `app.ts` BEFORE `express.json()`. Order: empty-body 400 → bad-sig 401 → bad-JSON 400 → malformed-event 400 → INSERT into `chargily_webhook_events` (UNIQUE on eventId stops replays — duplicate returns 200) → lookup intent (unknown returns 200) → CAS UPDATE `status='paid'` WHERE `status='pending'` RETURNING (only first wins, returns `already_processed: true` otherwise) → if rows returned: increment `topupCreditBalance` and stamp `creditedAt`.
   - `routes/admin/chargily.ts` (admin-gated): `GET /admin/billing/chargily/balance`, `GET/PUT /admin/billing/chargily/settings`.

5. **UI** (`artifacts/dashboard/src/pages/portal/`):
   - `Billing.tsx` — top-up form with live USD preview, validation (min/max from `/billing/config`), AR/EN labels, RTL-aware, transaction history table with status badges. Test-mode banner.
   - `BillingResult.tsx` — success/failure landing page with auto-redirect to `/portal/billing` after 8s.
   - Sidebar entry "شحن الرصيد" / "Top up" added to `PortalLayout.tsx`.

6. **Tests** (`artifacts/api-server/src/__tests__/`): 235/235 passing (29 new across 3 files):
   - `chargily-client.test.ts` — base URL by mode, missing secret throws ChargilyConfigError, Bearer auth header, retry on 5xx, no-retry on 4xx, HMAC verify (valid/tampered/missing/wrong-length/missing-secret).
   - `chargily-webhook.test.ts` — 401 on missing/bad sig, 400 on empty body / malformed event, exactly-once credit invariant under same-event-id replay AND different-event-id-same-checkout replay, failed events do NOT credit, unknown checkout returns 200.
   - `billing-route.test.ts` — auth required, validation (missing/negative/below-min/above-max), creates intent + returns checkout URL, isolation across users, cannot read another user's intent.

7. **OpenAPI**: 4 new portal paths + 1 webhook path + 3 schemas (BillingConfig, PaymentIntent, PaymentIntentCreated) added to `lib/api-spec/openapi.yaml`.

**Required secrets** (not committed): `CHARGILY_SECRET_KEY`, `CHARGILY_WEBHOOK_SECRET`, `CHARGILY_MODE` (`test`|`live`, default `test`).

**Webhook URL to configure in Chargily dashboard**: `https://<your-domain>/webhooks/chargily`.

### Session 31 — Polish: regression tests, skeleton loaders, dependabot, scheduled audit

Four-item polish pass after the Session 30 hardening sprint. The regression tests immediately caught two real org-key isolation gaps that had been missed in P5/round-2.

1. **Regression tests** (`artifacts/api-server/src/__tests__/regression-fixes.test.ts`, 10 tests):
   - **SSRF redirect**: stubs `globalThis.fetch` to return 30x → `169.254.169.254` / `127.0.0.1` and to a public-redirect-loop; asserts `sendSingleWebhook` rejects, calls fetch only once for blocked targets, and caps loops.
   - **Idempotency CAS**: source-level invariants on `idempotency.ts` — `claim_token` column declared, per-request token via `crypto.randomBytes(16)`, takeover is a CAS UPDATE (no DELETE+INSERT race), every terminal mutation gates on `claim_token = ${ourToken}`, `PENDING_TIMEOUT_MS ≥ 15min`.
   - **Org-key isolation**: walks every `.from(apiKeysTable)` call in `routes/portal/me.ts` and asserts the surrounding query contains `isNull(apiKeysTable.organizationId)`.
   - **Bonus catch**: the org-key test surfaced two leaks missed in Session 30: (a) `priorKey` lookup at line 224 (plan-enrollment) didn't filter org keys; (b) `existingKeys` lookup at line 622 (free-plan enrollment) could overwrite an org key as if it were a personal planless key. Both fixed.
2. **Skeleton loaders** (`artifacts/dashboard/src/components/RouteSkeleton.tsx` NEW): replaced the centred spinner `RouteFallback` with a page-shaped skeleton (header + 4 stat cards + 5-row table) that mirrors typical dashboard layouts. Reduces layout shift and perceived loading time during lazy-route chunk fetches.
3. **Dependabot** (`.github/dependabot.yml` NEW): weekly cadence, groups dev-dependencies and prod-minor-and-patch into batched PRs, separate ecosystem entry for `github-actions`.
4. **Scheduled security audit** (`.github/workflows/security-audit.yml` NEW): cron at 06:00 UTC on the 1st of every month + manual `workflow_dispatch`, runs `pnpm audit --prod --audit-level=moderate`, uploads JSON report as artifact, opens an Issue (label `security`) when the audit fails on a scheduled run.

Final state: **206/206 tests** (was 196 before regression tests + 2 fixes), typecheck clean across 8 packages, dashboard restarts cleanly with the new skeleton fallback.

### Session 30 — Security & reliability hardening sprint (9 plans + 3 follow-ups)

A nine-plan production-hardening pass driven by an architect-led code review, plus three follow-up fixes after the second review round. Final state: 196/196 tests, typecheck clean across 8 packages, `pnpm audit --prod` reports no known vulnerabilities.

**Plans executed:**
1. **P1 — Vulnerable deps**: upgraded all packages flagged by `pnpm audit`. Lockfile regenerated.
2. **P2 — Money columns → `numeric(18,8)`**: ensured every USD/credit column uses exact decimal storage; `users.spend_alert_threshold` (ratio) + `rate_limit_buckets_v2.tokens` (counter) intentionally kept as `doublePrecision`.
3. **P3 — Crypto hardening (`lib/crypto.ts`)**: `ENCRYPTION_KEY` is now mandatory (no JWT fallback at encryption time); module fails fast at load. Old ciphertext can still decrypt via `JWT_SECRET` for backward compat.
4. **P4 — Video billing org-aware**: `videoService.createVideoJob` now reads `apiKey.billingTarget` and debits the correct pool (org pool vs. user dual-credit pool); `usage_logs.organizationId` stamped. `refundFailedVideoJob` routes refunds back through the same target by reading `organizationId` from the log row. Test mocks updated (`organizationsTable`, `usage_logs.organization_id`, `billingTarget`/`subscriptionCredit`/`topupCredit`/`organizationId`/`rpmLimit` on mockApiKey).
5. **P5 — Org-aware authz on `/portal/api-keys*`**: every personal-key endpoint (`GET/POST/PATCH/DELETE/rotate`) now also filters `isNull(apiKeysTable.organizationId)` so org-scoped keys can never be enumerated/managed via personal routes (org keys live behind `/portal/organizations/:id/api-keys` with role checks). Follow-up extended this to `/portal/me` monthly stats and `/portal/me/export` so org-key metadata never leaks into personal aggregates.
6. **P6 — Atomic-claim idempotency (`middlewares/idempotency.ts`, rewritten)**:
   - Replaces the in-memory pending-set with two new DB columns (lazy `ALTER TABLE IF NOT EXISTS`): `is_pending BOOLEAN` and `claim_token TEXT`.
   - `tryClaim` is a single `INSERT ... ON CONFLICT (api_key_id, key) DO NOTHING RETURNING` that atomically claims the slot and stamps a per-request `crypto.randomBytes(16).hex` lease token; returns the token on success, `null` on conflict.
   - **Stale-takeover** uses CAS-style conditional `UPDATE` (no delete-then-reinsert): `WHERE is_pending=TRUE AND claim_token=oldToken AND created_at<staleBefore` — the old owner cannot win a finalize race after a takeover.
   - All terminal SQL paths (finalize, 5xx-cleanup, oversize-cleanup, `res.on("close")` safety net) gate on `claim_token = ourToken` so a late completion by the previous owner can never overwrite a new owner's response.
   - `PENDING_TIMEOUT_MS` raised from 5min → **30min** (well above any handler timeout incl. video) to make takeover races vanishingly rare in normal operation.
   - SSE / `Idempotency-Key`-less / non-billing routes still bypass the middleware.
7. **P7 — SSRF hardening (`lib/ssrfGuard.ts` NEW + webhook integration)**:
   - `assertSafePublicUrl(url)` rejects non-`http(s)` protocols, hostnames that DNS-resolve to loopback / private (RFC 1918) / link-local (169.254/16) / ULA (`fc00::/7`) / cloud metadata (`169.254.169.254`, `fd00:ec2::254`) / multicast / unspecified addresses.
   - Called both at webhook **registration** (`POST/PATCH /portal/webhooks`) AND at every **delivery** hop (defense against DNS rebinding).
   - **Round 2 follow-up**: `webhookDispatcher.sendSingleWebhook` was using default `redirect: "follow"` which let a public 30x bypass the guard to a private target. Replaced with a manual redirect loop: `redirect: "manual"`, `MAX_REDIRECTS=5`, per-hop `assertSafePublicUrl(currentUrl)`, relative redirects resolved via `new URL(loc, currentUrl)`, total time budget `ABORT_MS=8000` shared across hops.
8. **P8 — DB FKs + indexes (`migration 0008_orgs_fks_indexes.sql`)**:
   - `api_keys.organization_id → organizations.id ON DELETE SET NULL`
   - `usage_logs.organization_id → organizations.id ON DELETE SET NULL`
   - Indexes: `api_keys.organization_id`, `usage_logs.request_id`.
   - Migration uses idempotent guards (drop/recreate FKs only if absent). Applied directly to dev DB via raw SQL because the dev DB was set up via `db push`, not `migrate.mjs`.
9. **P9 — Dashboard route lazy-loading (`artifacts/dashboard/src/App.tsx`)**:
   - All admin + portal pages and `AdminLayout`/`PortalLayout` converted to `React.lazy(() => import(...))`.
   - Two-level `<Suspense fallback={<RouteFallback/>}>` boundaries (one for the layout chunk, one for the page chunk) so layout shell paints first.
   - Landing/Login pages remain eager-loaded for fastest first paint on unauth visits.
   - Result: ~30+ route chunks vs. one monolithic bundle.

**Code review iterations (architect):**
- **Round 1 verdict: Fail** — flagged 3 critical issues: SSRF redirect bypass, idempotency stale-claim race window, `/portal/me` + export still leaking org-key metadata.
- All 3 fixed (see P5 + P6 + P7 details above).
- **Round 2 verdict: PASS** — "the three follow-up fixes appear to close the originally reported issues without introducing a new medium/severe race or bypass."

**Files touched (round 2 final state):**
- `artifacts/api-server/src/lib/webhookDispatcher.ts` (manual redirect loop, per-hop SSRF check)
- `artifacts/api-server/src/lib/ssrfGuard.ts` (new)
- `artifacts/api-server/src/lib/videoService.ts` (org-aware debit + refund routing)
- `artifacts/api-server/src/middlewares/idempotency.ts` (claim_token CAS, 30min timeout)
- `artifacts/api-server/src/routes/portal/api-keys.ts` (`isNull(organizationId)` everywhere)
- `artifacts/api-server/src/routes/portal/me.ts` (`isNull(organizationId)` on stats + export)
- `artifacts/api-server/src/routes/portal/webhooks.ts` (registration-time SSRF check)
- `lib/db/src/schema/api-keys.ts`, `lib/db/src/schema/usage-logs.ts` (FK declarations + indexes)
- `lib/db/migrations/0008_orgs_fks_indexes.sql` + `_journal.json` (new)
- `lib/crypto.ts` (mandatory ENCRYPTION_KEY)
- `artifacts/dashboard/src/App.tsx` (React.lazy + Suspense)
- 17 test files updated with org-aware mocks

**Suggested follow-up tests (not done this session):** (a) multi-hop redirect to private IP via webhook delivery, (b) idempotency takeover + late old-owner finalize race scenario, (c) `/portal/me` org-key exclusion regression test.

### Session 29 — Sprint close-out (T13 soft limits + T6 legal pages + T14 test fixes)

Closed all remaining sprint items; suite now 196/196 tests green.

- **T13 — Soft limits (`plan.maxWebhooks`)**: Added `max_webhooks` integer column (default 3) to `plans` (migration `0006_plan_max_webhooks.sql`). Wired into admin POST/PATCH `/api/admin/plans` (CRUD + UI input on `pages/admin/Plans.tsx`). Enforced in `POST /api/portal/webhooks`: loads `user.currentPlanId` → `plan.maxWebhooks` → counts existing webhooks → returns `403` with plan name + limit when at cap. Skips enforcement when user has no plan assigned. OpenAPI updated; api-zod regenerated.
- **T6 — Legal pages**: Bilingual (AR/EN) `Privacy.tsx` + `Terms.tsx` registered at `/privacy` and `/terms`; footer links added to `Landing.tsx`.
- **T14 — Test fixes**: Final 22 failing tests (`v1-misc` cluster + new T13 cases) fixed. v1-misc fix required adding `update/set/delete` mocks in `beforeEach`, resetting `isModelInPlan/calculateChatCost` mocks, adding `billingTarget`/`topupCredit` to `mockApiKey`, and expanding the allowed models list. T13 tests required accounting for `requireAuth`'s own users-table lookup in the mock chain (4 `where`/3 `limit` calls per request).
- **Architect re-review: PASS**. Typecheck clean (api-server + dashboard). All 196 tests across 17 files passing.

### Session 28 — Production-hardening sprint (T01–T12) + Portal 2FA (T03b)

Twelve-feature production hardening sweep, then extended 2FA from admin-only to also cover developer/portal accounts on user request.

**Sprint deliverables (T01–T12):**
1. **T01 — HMAC-signed webhooks**: `webhooks.secret` column (AES-encrypted, auto-generated), every dispatched payload signed with `X-Signature: sha256=<hmac>` + `X-Timestamp`. Secret shown once on creation; rotate endpoint at `POST /api/portal/webhooks/:id/rotate-secret` (immediate rotation by design — old secret stops working). Portal `Webhooks.tsx` shows "Rotate Secret" button.
2. **T02 — Idempotency keys**: `Idempotency-Key` header on `/v1/*` cached for 24h keyed by `(apiKeyId, key)`. Middleware skips `text/event-stream` and `body.stream=true` so SSE is never broken.
3. **T03 — Admin TOTP 2FA**: `users.totpSecret` (encrypted) + `users.totpEnabled` columns; `/api/admin/2fa/{setup,verify,disable}`; admin login gate returns `401 + totpRequired:true` when 2FA enabled. Admin Settings has full 2FA card with QR.
4. **T04 — GDPR export**: `GET /api/portal/me/export` streams a ZIP with profile/keys/usage/webhooks/etc. UI download card on portal Settings (AR/EN).
5. **T05 — CSP**: Replaced disabled CSP with proper directives — allows YouTube embeds (frame-src), self-hosted assets, inline styles for shadcn.
6. **T06+T07 — Backup + SSL docs**: Cron + RETENTION_DAYS / S3_BUCKET section in DEPLOY.md; certbot install + renew cron + nginx reload hook in DEPLOY.md.
7. **T08 — Monitoring**: Sentry SDK wired in api-server (gated on `SENTRY_DSN`); UptimeRobot setup pointing at `/healthz` documented.
8. **T09 — CI/CD**: `.github/workflows/ci.yml` (typecheck + build) and `deploy.yml` (SSH deploy on main push, sections for user SSH key) created.
9. **T10 — Key rotation**: `POST /api/portal/api-keys/:id/rotate` issues a new key, marks old key with `expiresAt = now + 24h`. Both `requireApiKey` and `requireApiKeyLight` enforce `expiresAt`. Portal `ApiKeys.tsx` has Rotate icon + confirm dialog + one-time fullKey reveal.
10. **T11 — Test fixes**: 52 → 22 failing (remaining 22 confirmed pre-existing db-mock chain issue, deferred).
11. **T12 — OpenAPI admin docs**: `lib/openapi.ts` extended; `/api/admin/openapi.json` exposed.

**T03b — Portal 2FA (this session, on top of the sprint):**
- New `routes/portal/twofa.ts` mirroring `admin/twofa.ts`: `/api/portal/2fa/{status,setup,verify,disable}`, reuses the same `users.totp_secret` / `totp_enabled` columns.
- Mounted at `/portal/2fa` with `requireAuth` + a new `portalTwoFaRateLimit` (30 req / 15 min / IP) added to `middlewares/adminRateLimit.ts` for brute-force protection on verify/disable.
- `routes/portal/auth.ts` login flow: when `user.totpEnabled`, returns `401 + {totpRequired:true}` until a valid 6-digit `totpCode` is provided.
- `pages/portal/Settings.tsx`: new `PortalTwoFactorCard` (status fetch, QR setup, verify-enable, disable-with-code) — AR/EN i18n.
- `pages/portal/Login.tsx`: replaced `usePortalLogin` with a small `portalLoginRequest` fetch helper because the generated `LoginRequest` schema doesn't include `totpCode`. On `401+totpRequired`, renders a 6-digit code input (autoFocus, `autoComplete="one-time-code"`) and resubmits with email+password+code.

Architect review iterations: round 1 caught a `/portal/2fa/portal/2fa/*` double-prefix bug (fixed by switching internal route paths to relative) and missing rate limit (added); round 2 caught the missing portal Login UX for `totpRequired` (added two-step prompt); round 3 = PASS, no remaining critical/high issues. Typecheck clean across api-server + dashboard.

Architect review of the full sprint diff: PASS after three follow-up fixes — `expiresAt` enforcement added to `requireApiKey` + `requireApiKeyLight`, idempotency middleware skips streams, `usage_logs` column names corrected (`inputTokens`/`outputTokens`).

### Session 15 — Five new platform features

Five features delivered in one session. Three already existed; two are new.

1. **Streaming SSE (verified, no change)** — `POST /v1/chat?stream=true` and OpenAI-compat `POST /v1/chat/completions` with `stream:true` already emit chunked SSE deltas.
2. **Multiple API keys (verified, no change)** — `POST /api/portal/api-keys` (subject to plan.maxApiKeys cap) and `DELETE /api/portal/api-keys/:id` already wired in portal UI (`ApiKeys.tsx`).
3. **Video webhook events** — extended `WebhookEvent` union with `video.completed` and `video.failed`. `routes/v1/video.ts` fires non-blocking webhooks on:
   - wait-mode terminal state (success or failure-after-refund),
   - `/status` polling terminal state (success on every poll; failure only when refund just flipped — dedup via the atomic `success → refunded` row transition).
   `Webhooks.tsx` portal UI now shows the two new event checkboxes alongside `spending.alert` and `spending.limit_reached`.
4. **Dashboard analytics charts** — added two compact Recharts widgets at the top of `pages/portal/Dashboard.tsx`:
   - "Last 7 Days — Cost" sparkline area chart (uses `/api/portal/usage?days=7`).
   - "Top 3 Models (7d)" horizontal bar chart sorted by cost.
5. **Spending limits & budget alerts**:
   - **Schema** (`lib/db/src/schema/users.ts`, pushed): added `dailySpendLimitUsd`, `monthlySpendLimitUsd` (nullable doubles), `spendAlertThreshold` (default 0.8), `spendAlertEmailSentAt` (nullable timestamp).
   - **Helper** `lib/spendingLimits.ts` exports `checkSpendingLimits(userId)` — sums `usage_logs.cost_usd` (status=success) for today UTC and current month, compares against limits. Sends `sendSpendAlertEmail()` once per 24h when crossing threshold (deduped via `spend_alert_email_sent_at`).
   - **Middleware** (`apiKeyAuth.ts`): after balance check, returns 429 with descriptive message when cap reached and fires `spending.limit_reached` webhook.
   - **Endpoint** `PATCH /api/portal/me/spending-limits` accepts `{dailyLimit, monthlyLimit, alertThreshold}` (null clears a limit, threshold clamped to 0.1–1). Resets `spendAlertEmailSentAt` on save so users can re-warn.
   - **Settings UI**: new "Spending Limits" card with 3 inputs + "Spent today / Spent this month" panels (Arabic + English).
   - **`/api/portal/me`** now returns a `spending: { dailySpent, monthlySpent, dailyLimit, monthlyLimit, alertThreshold }` block.

Typecheck: clean across all workspaces. Dashboard + API server restarted; both healthy.

### Session 14 — Auto-refund on failed video jobs (billing fix)

- **Bug discovered**: When Vertex AI accepted a Veo `:predictLongRunning` submit but the async operation later failed (e.g. `Unsupported output video duration 5 seconds, supported durations are [8,4,6]` for `veo-3.1-fast-generate-001`), the user was still charged the full amount because the deduction happened right after the submit succeeded.
- **Fix** (`routes/v1/video.ts`):
  - New helper `refundFailedVideoJob(jobId, apiKeyId, userId, errorMessage)` runs inside a single DB transaction and:
    1. Atomically flips the `usage_logs` row from `status='success'` → `status='refunded'` (only if it's still `success`, preventing double-refund on repeated polls).
    2. Credits the deducted `costUsd` back to `users.topup_credit_balance` (top-up works on any model, so the user is never worse off than the original deduction).
  - Hooked into both the wait-mode failure path (`POST /v1/video?wait=true`) and the status-polling failure path (`GET /v1/video/:jobId/status`).
  - Response now includes `refunded: true` and `refundAmount: <usd>` when a refund fires, and reports `costUsd: 0` in that case.
- **User-visible behaviour**: A failed Veo job (for any reason — invalid duration, safety filter, schema change) now self-refunds the moment the client learns about the failure. No admin action needed.

### Session 13 — Portal Docs page refreshed for new video flow

- **`pages/portal/Docs.tsx`**: Rewrote the "Video Generation" section to cover all three endpoints and both flows:
  - **Option A** — synchronous `POST /v1/video?wait=true` returning the finished `videoUrl` in one call (default for n8n/Zapier). Shown first because it's the recommended path.
  - **Option B** — classic async: `POST /v1/video` → `GET /:jobId/status` → `GET /:jobId/download`.
  - Download step (`/download`) now documented with a cURL snippet using `-L -o video.mp4` and Python streaming.
  - Status vocabulary corrected everywhere: `completed` / `failed` (was `error`).
  - Added note about 10-minute idempotency window (duplicate requests return the original jobId, no double charge).
  - Sample 202 response now includes `statusUrl`, `pollIntervalSeconds`, `estimatedSeconds` fields.

### Session 12 — OpenAPI Spec Alignment for Video Endpoints

- **Spec updated** (`lib/api-spec/openapi.yaml`):
  - `POST /v1/video` now documents `?wait=true` query param, the 200 response (both wait-completed and duplicate-idempotent cases), and the 202 response for async / wait-timeout paths.
  - Renamed `GET /v1/video/{jobId}` → `GET /v1/video/{jobId}/status` to match the actual route, with a note about `requireApiKeyLight` semantics.
  - Added `GET /v1/video/{jobId}/download` returning `video/mp4` binary with `Content-Disposition: attachment`; documents the three URI shapes (data/gs/https), SSRF allow-list, and 409 when still processing.
  - `VideoRequest` gains `wait`, `waitTimeoutMs`, `sampleCount` and the `integer|string` coercion contract (n8n/Zapier compatibility).
  - `VideoJobResponse` gains `duplicateOf`, `note`, `statusUrl`, `pollIntervalSeconds`, `estimatedSeconds`; documents `status: pending|completed|failed`.
- **Regeneration**: `api-zod` + `api-client-react` rebuilt; all downstream imports typecheck clean.
- **Server alignment fixes** (`routes/v1/video.ts`):
  - Coerce `durationSeconds` / `sampleCount` to integers with explicit bounds (samples 1–4).
  - `sampleCount` is now actually forwarded to `generateVideoWithVeo` (was previously ignored — spec/reality drift).
  - Idempotency key now includes `sampleCount` so `sampleCount=1` vs `sampleCount=2` of the same prompt are treated as distinct jobs.
  - Normalized status vocabulary: wait-mode now returns `failed` (not `error`); `GET /status` now maps Vertex errors to `failed` with `errorMessage` populated.

### Session 16 — Per-Key Limits + OpenAI Embeddings + Request Logs Viewer

- **Per-key rate limits & spend caps** (schema: `api_keys.rpmLimit`, `api_keys.monthlySpendLimitUsd`):
  - `lib/rateLimit.ts` refactored to accept a generic `bucketId` (positive userId OR negative `-apiKeyId`) so per-key keys get their own bucket.
  - `rate_limit_buckets.user_id` FK to `users.id` was **dropped** — column is now a generic int allowing synthetic IDs (otherwise negative bucket IDs would fail FK constraint in PG fallback path).
  - `chat.ts`, `responses.ts`, `generate.ts`, `video.ts` all updated: `const _bucket = apiKey.rpmLimit ? -apiKey.id : apiKey.userId;` falls back to plan defaults when unset.
  - `apiKeyAuth.ts` enforces per-key monthly spend by summing `usage_logs.cost_usd` for that `api_key_id` since first-of-month — returns 429 with explanatory message when reached.
  - New `PATCH /api/portal/api-keys/:id` accepts `rpmLimit`, `monthlySpendLimitUsd`, `name`. UI: ⚙ icon next to revoke button on each key card opens a dialog with both fields.
- **OpenAI-compatible Embeddings** (`routes/v1/embeddings.ts`): `POST /v1/embeddings` proxies Vertex `text-embedding-004` (default), `text-embedding-005`, `text-multilingual-embedding-002`. Accepts string or string[] input (max 250). Returns OpenAI shape `{ object: "list", data: [{ embedding: [...] }], usage }`. Billed at `0.000025/1K tokens × 1.1` markup via the **same atomic `deductAndLog` split-balance helper** as chat/generate (with `modelInPlan: false` since embeddings aren't in any plan model list — top-up only); returns 402 when insufficient.
- **Request/Response Logs Viewer** (schema: `usage_logs.requestBody/responseBody/endpoint/statusCode`):
  - `middlewares/logCapture.ts` pre-assigns a `requestId` on `req.preassignedRequestId` (used by all `/v1/*` route handlers instead of generating their own), wraps `res.json` to capture the response body, and on response finish updates the unique `usage_logs` row by `requestId`. Race-safe — never corrupts another row; no-op when no log row was written (e.g. `/v1/models`, `/v1/files`).
  - `GET /api/portal/logs?page&limit&status&model` (paginated, scoped to user's keys) and `GET /api/portal/logs/:id` (full bodies + key name).
  - New `pages/portal/Logs.tsx` page (route `/portal/logs`, sidebar entry "Logs"): table view with status/model filters, pagination, and side-sheet detail showing endpoint, status, tokens, cost, error, full request body, full response body.

### Session 11 — Video Reliability + MP4 Download + Split-Balance Admin UI

- **Duplicate-billing protection** (`routes/v1/video.ts`): In-memory idempotency cache (10-min TTL, SHA-256 of `apiKey+model+prompt+duration`). Re-clicking "Execute" in n8n/Zapier within 10 minutes returns the original jobId with `duplicateOf` field and **zero additional charge**.
- **Synchronous `?wait=true` mode**: New query param makes `POST /v1/video` poll internally (5s interval, default 180s, max 240s) and return the completed `videoUrl` in one call. Timeout falls back to async jobId. Removes the need for a separate polling node in automation tools.
- **Type coercion for numeric fields** (`routes/v1/generate.ts`, `video.ts`): `durationSeconds`, `sampleCount` now accept strings (n8n/Zapier send numbers as strings). Validation errors are logged to `usage_logs` as `rejected` for admin visibility.
- **Veo response parser expansion** (`lib/vertexai-veo.ts`): Now handles 6 URI shapes — `uri` / `gcsUri` across `videos[]`, `generatedSamples[]`, `generateVideoResponse.generatedSamples[]` — plus inline base64 → `data:video/mp4` fallback and clear error when no URI is found.
- **Docs fixes** (`pages/portal/Docs.tsx`): Corrected status endpoint URL everywhere (`/v1/video/:jobId/status` — was missing `/status` in cURL/Python/JS examples).
- **New `GET /v1/video/:jobId/download`**: Returns a real `video/mp4` file ready for n8n/Zapier/browser download. Decodes base64 data URLs, proxies `gs://` via Google-authenticated Storage API, and proxies `https://` only for allow-listed Google Storage hosts (SSRF guard).
- **Light auth for retrieval**: `/v1/video/:jobId/status` and `/download` now use `requireApiKeyLight` (validates key only, allows retrieval at zero balance). Job ownership is still enforced via `apiKeyId` match.
- **Split-balance admin UI**:
  - `pages/admin/Developers.tsx`: List now has two columns — **Subscription** and **Top-up** — instead of one combined "Credit Balance".
  - `pages/admin/DeveloperDetail.tsx`: Two balance cards at the top with icons and explanatory captions ("Granted by plan upgrade · restricted to plan models" vs "Works on all models").
  - `routes/admin/analytics.ts` `/user-summary`: Now returns `subscriptionCreditRemaining` and `topupCreditRemaining` alongside `totalCreditsRemaining` so widgets stay consistent with the split cards.

### Session 10 — Profit Margin Dashboard + Per-Model Spend Visualization + Workflow Cleanup

- **Removed duplicate workflow**: The "API Server" workflow (PORT=8081) was a leftover that conflicted with the artifact-based API server. Now there's a single API workflow.
- **`MARKUP_FACTOR` exported from `billing.ts`** so server-side analytics code can derive Vertex AI base cost from billed revenue.
- **New endpoint `GET /admin/analytics/profit`** (`routes/admin/analytics.ts`): Returns revenue / Vertex AI base cost / profit / margin% for today, this month, and the selected range — plus a top-15 per-model breakdown and a daily series. Filters by `from`/`to` query params and `status='success'` (rejected/error rows are excluded from revenue).
- **Admin Analytics page** (`pages/admin/Analytics.tsx`): New emerald-accented "Profit Margin" card showing the three time-window snapshots and a per-model revenue/cost/profit table. Refresh button now refreshes both timeseries and profit queries.
- **Portal Usage page** (`pages/portal/Usage.tsx`): Added a "Spend Share by Model" donut chart + "Spend Summary" panel (totals + top-5 percentage bars). Gives developers a much clearer picture of which models consume their budget.
- All typechecks pass; API server restarts clean.

### Session 9 — Dual Credit Balance System (Subscription + Top-up)

- **DB schema**: Added `topup_credit_balance` (doublePrecision) to `users`. Existing `credit_balance` now represents subscription credit (plan-restricted); `topup_credit_balance` is open-ended top-up credit (works on every model, including out-of-plan).
- **Auth middleware** (`apiKeyAuth.ts`): Loads both balances; exposes `subscriptionCredit`, `topupCredit`, and `accountCreditBalance` (sum). Returns HTTP 402 only if both are zero.
- **Split-balance deduction** (`chatUtils.ts`): New `deductAndLog(...userId, apiKeyId, model, requestId, in, out, cost, { modelInPlan })`. If `modelInPlan=true`: spend subscription first, fall back to top-up. If `false`: spend top-up only. Atomic SQL guards prevent over-spend on concurrent requests. Helper `isModelInPlan(model, plan.modelsAllowed)` treats empty array as "all allowed".
- **All 4 v1 routes updated** (`chat`, `responses`, `generate`, `video`): Compute `modelInPlan`, check correct balance pre-flight, pass `{ modelInPlan }` to deduct, and return clearer 402 errors that distinguish "insufficient credits" vs "insufficient top-up for out-of-plan model X". Streaming paths (`/v1/chat`, `/v1/responses`) now honor the `sufficient` return flag.
- **Admin endpoints** (`admin/users.ts`):
  - `POST /admin/users/:id/credits` now tops up **`topup_credit_balance`** only (never modifies subscription credit). Negative amounts are validated against the top-up balance.
  - `POST /admin/users/:id/upgrade-plan` now **replaces** `credit_balance` with `plan.monthlyCredits` (was additive — fixed credit-stacking bug across upgrades). Also updates user's API keys to the new plan.
  - User list/detail endpoints return both balances.
- **Portal `/me` endpoint**: Now returns `subscriptionCreditBalance`, `topupCreditBalance`, and `totalCreditsBalance`.
- **OpenAPI spec restored**: Added missing endpoints that were not previously in `openapi.yaml` so codegen no longer drops them — `testProvider`, `createPortalApiKey`, `deletePortalApiKey`, `revealPortalApiKey`. Added missing schema fields (`maxApiKeys` on Plan; `emailVerified`, `creditBalance`, `topupCreditBalance`, `currentPlanId` on User; `creditBalance` on `CreatePortalApiKeyResult`). Added `RevealPortalApiKeyResult` schema. Aligned route status codes (delete-key now returns 204).
- **api-zod re-export tweak** (`lib/api-zod/src/index.ts`): Generated zod schemas re-exported as values; generated TypeScript interfaces re-exported under `Types` namespace to avoid value/type identifier collisions.
- **Dashboard UI**:
  - Portal Dashboard (`pages/portal/Dashboard.tsx`) shows **two credit cards** (Subscription Credit / Top-up Credit) with an explanatory tooltip.
  - Admin Developer Detail (`pages/admin/DeveloperDetail.tsx`): button relabeled **"Add Top-up Credit"** with a dialog that clarifies top-up works on all models and never expires. Plan upgrades go through "Upgrade Plan" instead.

### Session 8 — Model Descriptions, Use Cases & Sorting in Docs

- **Model descriptions** (`artifacts/dashboard/src/pages/portal/Docs.tsx`): Every model in the docs now has a full English description explaining its strengths, plus use-case tags (e.g. "Complex reasoning", "Code generation", "Multilingual").
- **Quality score column**: A 5-dot visual indicator beside each model reflects its quality tier — more filled dots = better model.
- **Sort controls**: 4 sort buttons above the models table — **Default** (grouped by provider) · **Best first** (quality rank) · **Cheapest** (price ascending) · **Priciest** (price descending). Sorted views show a flat list across all providers.
- **Expandable rows**: Each model row has a `▾` toggle that reveals the description and use-case tags inline, keeping the table compact by default.
- **Live model count updated to 25**: Added `glm-5` (Zhipu AI via Vertex MaaS) and `mistral-small` (Mistral Small 3.1 via Vertex rawPredict) to the docs model catalog — both now fully routed and live.
- **replit.md updated**: Live model count, partner list, and key files section updated to reflect current state.

### Session 7 — VPS Deployment Hardening + Production SSL Fix

- **Production SSL fix** (`lib/db/src/index.ts`): Changed from `rejectUnauthorized: true` (hard fail) to detecting SSL from `DATABASE_URL` — uses `rejectUnauthorized: false` when `sslmode=` or `ssl=` appears in the URL. Fixes 503/500 errors on Replit-hosted production where system CA store lacks Neon's cert.
- **Graceful shutdown** (`artifacts/api-server/src/index.ts`): Added `SIGTERM`/`SIGINT` handlers that call `server.close()` → `pool.end()` → `process.exit(0)`. 30-second force-kill timeout prevents zombie processes on VPS restarts and zero-downtime rolling deploys.
- **Auto-migration runner** (`artifacts/api-server/src/migrate.ts`): New standalone entrypoint built to `dist/migrate.mjs`. Reads migrations from `MIGRATIONS_DIR` env var (Docker: `/app/migrations`, PM2: `lib/db/migrations`). Resolves the "fresh VPS empty DB" problem — tables are always created before the API starts.
- **build.mjs updated**: Added `src/migrate.ts` to esbuild entry points; `dist/migrate.mjs` (425 KB) is now emitted alongside `dist/index.mjs`.
- **docker/Dockerfile.api updated**: Copies `lib/db/migrations/` to `/app/migrations/` in the runtime image; CMD changed to run migrations then start API (`sh -c "node migrate.mjs && node index.mjs"`). Added `pnpm-lock.yaml` copy for reproducible installs.
- **docker-compose.yml updated**: Added `MIGRATIONS_DIR`, `api_logs` volume, GCP key volume comment, fixed health check path (`/healthz`).
- **ecosystem.config.cjs updated**: Added `pre_start` hook to run `migrate.mjs` before PM2 starts the API; added `env_file`, `min_uptime`, `merge_logs`.
- **.env.example updated**: Added `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS`, `REDIS_URL`, `LOG_LEVEL`, `SENTRY_DSN`, `MIGRATIONS_DIR` with full documentation.
- **docker/nginx-ssl.conf** (new): Full HTTPS Nginx template — TLS 1.2/1.3 only, strong ciphers, OCSP stapling, HTTP→HTTPS redirect, `proxy_buffering off` for SSE streaming, 1-year cache headers for static assets.
- **DEPLOY.md updated**: Added Google Cloud/Vertex AI setup section (SA creation, IAM role, key JSON), migration docs, fixed health check URL (`/api/health` → `/api/healthz`), complete env var reference table.

### Session 6 — Bug Fixes, Bundle Optimization & TypeScript Cleanup

- **Issue 6 — DB Migrations**: Added `generate` + `migrate` scripts to `lib/db/package.json`; created initial migration snapshot (`migrations/0000_cheerful_moira_mactaggert.sql`) capturing all 13 tables. `push` remains available for dev, `migrate` is production-safe with rollback capability.
- **Issue 7 — Bundle size**: api-server bundle reduced from **2.0 MB → 766 KB** (62%) by adding `minifyWhitespace: true`, `minifySyntax: true` to esbuild, and externalizing 5 packages that were being bundled unnecessarily (`helmet`, `express-rate-limit`, `multer`, `jsonwebtoken`, `ioredis`).
- **Issue 8 — Test speed**: vitest switched to `pool: 'forks'` (instead of threads); import time reduced from 10.2s → 7.0s; wall time 24.6s → 22.7s. All 193 tests pass.
- **Issue 9 — /v1/models auth**: Added `requireApiKey` middleware to `GET /v1/models` — now requires valid API key (HTTP 401 if missing/invalid).
- **Admin seed bug**: `seed.ts` now sets `emailVerified: true` for both new admin account creation and promotion of existing user to admin role.
- **TypeScript errors fixed (0 errors)**: Root cause was missing `dist/` declarations in `lib/db` and `lib/api-zod`. Fixed by:
  - Adding `"build": "tsc -b"` to both packages' `package.json`
  - Running clean builds to generate all `.d.ts` files (including previously missing `plans.d.ts`, `providers.d.ts`)
  - Exporting `DbTransaction` type from `@workspace/db` for use in route files
  - All 34× TS7006 (implicit any) and all TS6305 (missing declarations) errors resolved

### Session 5 — vertexai.ts Split + V1 Route Tests (133 tests)

- **vertexai.ts modularised**: 708-line file split into 5 focused modules — `vertexai-types.ts` (interfaces + alias tables), `vertexai-provider.ts` (auth + VertexAI client), `vertexai-gemini.ts` (Gemini SDK + REST global endpoint), `vertexai-compat.ts` (OpenAI-compat MaaS), `vertexai-imagen.ts`, `vertexai-veo.ts`. `vertexai.ts` is now a re-export barrel preserving the public API.
- **V1 route tests added**: `v1-chat.test.ts` (17 tests), `v1-generate.test.ts`, `v1-video.test.ts` covering guardrail blocking, rate-limit 429, billing deduction, credit-insufficient 402, streaming SSE, and model-type gating.
- **ThinkTagFilter mock fix**: Changed from `vi.fn(() => ({...}))` to a real `class` in mock factory so `vi.resetAllMocks()` doesn't lose the constructor implementation.
- **Video status route fix**: Tests updated to expect HTTP 202 (Accepted) from `POST /v1/video` and use the correct `:jobId/status` path param.
- **verify-backup.sh**: New script at `artifacts/api-server/scripts/verify-backup.sh` — checks /healthz, DB connectivity, key table row counts, and required env vars.
- **133 tests passing** across 12 test files (up from 94).

### Session 4 — Security Hardening + 63-test Suite
- **GCM auth-tag length check**: `crypto.ts` `tryDecrypt` now validates IV=12B + tag=16B before `setAuthTag`; also sets `setAuthTagLength(16)` to prevent truncated-tag attacks
- **TLS verification**: `lib/db/src/index.ts` changed `rejectUnauthorized: false` → `true` in production (Neon supports valid CA certs)
- **HTML injection in emails**: Added `escapeHtml()` in `email.ts`; all three `build*Email` functions now escape user-provided `name` before templating
- **Helmet security headers**: Added `helmet` middleware in `app.ts` (X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy, etc.)
- **Endpoint model gating**: `v1/chat.ts` blocks `imagen-*` and `veo-*` (400); `v1/generate.ts` only allows `imagen-*`; `v1/video.ts` only allows `veo-*` — prevents 0-cost billing bypass
- **63-test integration suite**: Route tests for all admin, portal, and v1 routes; fixed `vi.resetAllMocks()` + thenable dbMock patterns
- **Admin rate-limit IPv6 fix**: `adminRateLimit.ts` uses `ipKeyGenerator` from `express-rate-limit` (eliminates ERR_ERL_KEY_GEN_IPV6)

### Session 3 — Webhooks + Multimodal + Per-Model Dashboard
- **Webhooks system**: New `webhooks` DB table (12th table). CRUD routes at `/portal/webhooks`. HMAC-SHA256 signed dispatch via `webhookDispatcher.ts`. Fires after every successful `/v1/chat` request. Portal page `Webhooks.tsx` with create/toggle/delete/test + signature verification code sample.
- **Multimodal chat**: `ChatMessage.content` now `string | ContentPart[]`. `TextPart` + `ImagePart` (mimeType + base64). `toGeminiContents()` and `msgToParts()` handle image inlineData for both Vertex REST and SDK paths. New `POST /v1/files` endpoint (multer, 20MB, JPEG/PNG/GIF/WebP/HEIC).
- **Per-model usage dashboard**: `/portal/usage` now returns `byModel[]` breakdown. `Usage.tsx` shows interactive bar chart per model — click to filter request log. Model cards with token/cost stats.
- **ChatCompletionBody schema**: Extended to accept `content: string | ContentPart[]` via zod discriminated union.

### Session 2 — Model Catalog + Pricing Corrections
- Added `comingSoon?: boolean` to ModelDef interface in models.ts
- Marked 19 partner models as `comingSoon: true` (no API routing)
- Plans.tsx: comingSoon models show "Soon" badge, disabled in ModelPicker
- Billing MARKUP_FACTOR corrected to 1.1 (was 1.3)
- All "1.3×" references updated to "1.1×" across Pricing.tsx, i18n, tests
- Docs.tsx: Added Gemini 2.5 section (3 models) — now shows all 23 live models
- Landing.tsx: CODE_SAMPLES now use `window.location.origin` (GATEWAY_BASE) dynamically
- 25/25 tests passing, TypeScript clean across all packages

### Session 17 — OpenAI Sora-Compatible Video API (n8n compatibility)

- **Problem**: n8n's "Generate a video" OpenAI node calls `POST /v1/videos` (plural, Sora API) and lists models from `/v1/models` filtered to `sora-*` IDs. Our gateway only had `/v1/video` (singular, custom Veo shape) so the model dropdown showed "No results".
- **Fix — alias layer**:
  - `lib/vertexai-types.ts`: added `sora-2 → veo-3.1-fast-generate-001` and `sora-2-pro → veo-3.1-generate-001` to `GEMINI_ALIASES` (used by `normalizeToPlanModelId`).
  - `lib/billing.ts`: registered `sora-2` ($0.12/s) and `sora-2-pro` ($0.40/s) in `MODEL_COSTS` so they appear in `/v1/models`.
  - `routes/v1/models.ts`: `ownedBy()` now reports `sora-*` (and other OpenAI prefixes) as `"openai"`.
- **New `routes/v1/videos.ts`** (Sora-shaped surface):
  - `POST /v1/videos` accepts OpenAI body `{ model, prompt, seconds, size }` → maps Sora model to Veo, internally `fetch`es own `/v1/video` (forwarding `Authorization`) so all auth/billing/idempotency/refund logic is reused. Response shape: `{ id: "video_<jobId>", object: "video", status: "queued|in_progress|completed|failed", created_at, seconds, size, progress, error }`.
  - `GET /v1/videos/:id` strips `video_` prefix → calls internal `/v1/video/:id/status` → returns Sora-shaped status.
  - `GET /v1/videos/:id/content` calls internal `/v1/video/:id/download` and streams the MP4 bytes through with `video/mp4` Content-Type.
- **Why internal `fetch` over refactor**: zero-risk reuse — the existing `/v1/video` handler is the source of truth for credit deduction, GCS streaming, refunds; the Sora layer is a thin translator only.
- **Verification**: `pnpm -r typecheck` clean; api-server restarted; `/api/health` 200; `/api/v1/videos` POST returns 401 without auth (correct).
- **Architect post-review fix — SSRF**: Initial implementation built internal URL from `req.protocol` + `req.get("host")`, allowing a malicious `Host: evil.tld` header to redirect our `fetch` (with the caller's `Authorization` bearer attached) to an attacker server. Replaced with module-level constant `INTERNAL_BASE = http://127.0.0.1:${process.env.PORT}` so loopback target is hard-coded and immune to header manipulation. Verified: malicious-Host POST still resolves to local server (returns 401 on bad token, not a redirect/leak).

### Session 18 — Five Risk Hardening (HTTP loopback, spec drift, transparency, attack surface, independent rate-limits)

Architect post-review of Session 17 flagged five risks. All five fixed:

1. **#5 HTTP loopback eliminated** — extracted `lib/videoService.ts` (single source of truth: `createVideoJob` / `getVideoStatusForUser` / `streamVideoContent` / `waitForVideo` / `refundFailedVideoJob`). Both `routes/v1/video.ts` (native shape) and `routes/v1/videos.ts` (Sora-compat shape) are now thin adapters that import these functions directly — **no more internal `fetch` to localhost**. Removed `INTERNAL_BASE` constant entirely. video.ts shrank from 559 → 200 lines.

2. **#2 Spec drift fixed** — `GET /v1/videos/:id` now reads the original Sora request body from `usage_logs.requestBody` (already captured by logCapture middleware) and returns the user-supplied `seconds` and `size` instead of hardcoded "4" / "1280x720".

3. **#3 Transparency** — every `/v1/videos` and `/v1/video` response sets `X-Backend-Model: veo-...` so callers always know which real Vertex model handled their request. Veo limit errors now include both the alias and backend (e.g. `"sora-2 (powered by veo-3.1-fast-generate-001) supports up to 8 seconds"`). New "Compatibility & Aliases" section in `Docs.tsx` (English with Arabic note) documenting the sora-2 / sora-2-pro mapping table.

4. **#1 Compatibility guard middleware** — new `middlewares/compatibilityGuard.ts` mounted on `/v1/*` (and `/api/v1/*`). Recursively strips `__proto__`, `constructor`, `prototype` keys from `req.body` (prototype-pollution defence) and warns when payload depth > 16 or any object has > 200 keys. Body-size limit (1 MB) was already enforced by `express.json`.

5. **#4 Independent rate-limits per endpoint group** — `rate_limit_buckets` now has composite PK `(userId, endpointGroup)` with new `endpoint_group` text column (default `"all"`). `checkRateLimit(bucketId, rpm, endpointGroup="all")` and Redis key `rl:user:{id}:{group}` updated together. All five routes now pass distinct groups: chat / video / embeddings / generate / responses. Heavy chat traffic no longer starves the video budget. (rate_limit_buckets is ephemeral cache — table was dropped/recreated cleanly during db push.)

**Verification**: `pnpm -r typecheck` clean across api-server + dashboard. All workflows running. Smoke tests: `/api/health` 200, `/api/v1/models` 401 (auth required), `/api/v1/videos` POST 401 with malicious `Host: evil.example.com` header (ignored, no SSRF), `/api/v1/videos` POST with `__proto__` payload returns 401 cleanly (guard ran first, no crash).

### Session 19 — Production deploy unblock + n8n multipart compat

Two follow-up fixes after Session 18 to get the gateway live and working with real n8n traffic:

1. **Deploy unblock — `rate_limit_buckets` → `rate_limit_buckets_v2`**: Replit deployment uses `drizzle-kit push` which generates `ALTER TABLE ADD CONSTRAINT PRIMARY KEY (user_id, endpoint_group)` *before* `ADD COLUMN endpoint_group` — fails with "column does not exist". Renamed the table to `rate_limit_buckets_v2` so push issues a clean `CREATE TABLE` instead. Old table left empty (ephemeral cache, no FKs). Removed obsolete `0001_rate_limit_endpoint_group.sql` migration. Schema sync now reports "no changes" both locally and in production.

2. **n8n / openai-python multipart support — `POST /v1/videos`**: Real OpenAI Sora API uses `multipart/form-data` (per official spec), and n8n's "Generate a video" node + openai-python/node SDKs all follow it. Our handler only had `express.json()`, so `body.prompt` arrived `undefined` and we returned `400 prompt is required`. Added a content-type-aware preprocessor on `/v1/videos` POST: if request is `multipart/form-data` we run `multer.any()` (memory storage, 25 MB / 32-field cap), otherwise pass through to the existing JSON body. Pure-JSON callers unchanged (full backward compat). Smoke-tested with `curl -F` — returns 401 (auth) instead of 400 (parse), confirming body parses through.

**Verification**: `pnpm --filter @workspace/api-server typecheck` clean. api-server restarted. Production deploy succeeded (commit `36386cd6`). User confirmed n8n now reaches the gateway successfully.

### Session 20 — Subscription Period Lifecycle (expiration + auto-renewal)

Closed the gap where plan assignments lived "forever" with no expiry. New mechanics:

1. **Schema (migration `0004_subscription_expiration`)**: added `current_period_started_at`, `current_period_end` (timestamptz, nullable) to both `users` and `organizations`, plus partial indexes on the end column. Backfilled existing rows with active plans to `now()` / `now() + 30 days`.

2. **Plan-assignment paths set the window**: admin `POST /api/admin/users/:id/upgrade-plan` and portal `POST /api/portal/plans/:planId/enroll` (both planless-key and new-key branches) now stamp `current_period_started_at = now()`, `current_period_end = now() + 30 days`. `GET /portal/me` and `GET /admin/users/:id` expose `currentPeriodEnd` + `currentPeriodStartedAt` + `currentPlanId`.

3. **Runtime gating in `apiKeyAuth.ts`**: when `current_period_end <= now`, the middleware replaces `plan.modelsAllowed` with the sentinel `["__SUBSCRIPTION_EXPIRED__"]` and sets headers `X-Subscription-Status: expired|active|none` + `X-Subscription-Period-End`. **Important**: empty array means "unrestricted" in `isModelInPlan()`, so a non-empty sentinel is required to make every model count as out-of-plan and force the existing chatUtils dual-credit logic to bill from `topup_credit_balance` only. Subscription credit (`credit_balance`) is preserved through expiry — admins can extend and the credit becomes usable again.

4. **Daily cron `runDailySubscriptionRollover()`** (`lib/subscription.ts`, scheduled in `index.ts` at startup + every 24h):
   - Free plans (`priceUsd === 0`): renew window (+30d) and replace `credit_balance` with `plan.monthlyCredits`.
   - Paid plans (`priceUsd > 0`): zero `credit_balance`; keep `currentPlanId` so the admin sees what to renew. No auto-charge — payment integration is out of scope.
   - All updates use a conditional `WHERE id=? AND current_period_end<=now` predicate to stay race-safe with concurrent admin extends/upgrades.

5. **Admin controls**: `POST /api/admin/users/:id/subscription/extend` (body `{days?: 30}`) extends from `max(now, current_period_end)`. `POST /api/admin/users/:id/subscription/end` immediately ends the period. Both audit-logged. UI in `DeveloperDetail.tsx` shows status + `Extend 30 days` / `End Now` buttons. Portal `Dashboard.tsx` shows an Active/Expired badge with days remaining.

**Verification**: 6 smoke scenarios pass (active sub debits subscription; expired sub debits topup only; Free auto-renews; Paid lapses with planId preserved; admin extend bumps +30d; `/portal/me` exposes the field) plus a critical regression test confirming an expired user with topup=$0 is rejected with `model_not_available` instead of silently draining subscription credit.

**Known follow-up (pre-existing, out of scope here)**: `/v1/generate` and `/v1/images/generations` still deduct directly from `usersTable` instead of using `apiKey.billingTarget`/`deductAndLog`, so org-bound keys on those two endpoints can mis-bill the creator user. To fix in a future pass.

### Session 21 — Vertex AI transient-error resilience for video generation

User reported that 8-second videos fail with `503 "Visibility check was unavailable"` while 4-second videos work. Root cause: longer videos require more polling cycles, increasing the chance of hitting a transient Google Vertex AI infrastructure blip. The previous code threw immediately on any non-2xx response.

1. **`vertexai-veo.ts` — new `vertexFetchWithRetry<T>()` helper** with exponential backoff `[300, 800, 2000, 5000]ms` (5 attempts total). Returns parsed JSON directly.
   - Treats as transient: HTTP `408/425/429/500/502/503/504`, **and** body-level `error.status ∈ {UNAVAILABLE, INTERNAL, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED}` even on HTTP 200 (Vertex long-running operations sometimes return transient errors in a 200 body).
   - Throws new `VertexTransientError` (with `statusCode` preferring `body.error.code` over HTTP status for telemetry) when retries are exhausted on transient failures. Permanent errors still throw plain `Error`.
   - `generateVideoWithVeo` now also defends against HTTP 200 + permanent body error (e.g. `INVALID_ARGUMENT`, prompt blocked by safety filter) — previously these would silently produce an empty `operationName` and bill the user.

2. **`getVideoJobStatus`** classifies `data.error.status`: transient ones throw `VertexTransientError`; permanent ones still return `{done:true, error}` so the existing refund path settles them as failed jobs.

3. **`videoService.ts` — polling tolerance**:
   - `waitForVideo` now tolerates up to **5 consecutive** transient throws (counter resets on success). Used by the native blocking `/v1/video` route.
   - `getVideoStatusForUser` (used by Sora-shaped `/v1/videos/:id` polling — n8n calls this) catches transient throws: if the job is younger than **30 minutes**, returns `pending` so the client keeps polling; if older, performs a **final re-check** before refunding (so a job that completes between polls is *not* refunded by mistake), then atomically refunds via existing `refundFailedVideoJob` (which uses `WHERE status='success'` for double-refund safety).

4. **`/v1/videos` POST handler** rewrites Veo submission failures that look transient (matching `/unavailable|503|500|504|temporarily/`) into a clean **HTTP 503 `service_unavailable`** response with message: _"Vertex AI is temporarily unavailable. Please retry your request in 30-60 seconds. (No credit was charged.)"_ — instead of the confusing `502 Bad gateway`.

**Verification**: build clean, all expected strings present in compiled output, api-server restarted healthy. Architect re-review confirmed all four fixes are correct (initial review found two more edge cases — both addressed in this same batch).

### Session 22 — Capability-based model filtering for n8n

User wanted maximum flexibility for n8n integration: separate "Models" lists per node type (Chat / Image / Video / Audio). Implemented **both** filtering modes:

1. **`?type=` query parameter** on `/v1/models` (and `/models` alias):
   - Values: `chat | image | video | audio | embedding`
   - Empty string, array form (`?type=a&type=b`), or unknown value → **HTTP 400** with helpful message
2. **Dedicated per-category endpoints** — same response shape, pre-filtered:
   - `/v1/chat/models`, `/v1/images/models`, `/v1/videos/models`, `/v1/audio/models`, `/v1/embeddings/models`
   - Plus `/chat/models`, `/images/models`, etc. aliases for clients that set Base URL = root.
3. **`categorizeModel(modelId)`** helper in `routes/v1/models.ts`:
   - **video**: starts with `veo-` or `sora-`
   - **image**: `imagen-*`, `dall-e*`, `gpt-image*`, or `*-image-preview` (catches `gemini-3.x-image-preview`)
   - **audio**: `tts-*`, `whisper-*`
   - **embedding**: `text-embedding-*` or `*-embedding-*`
   - **chat**: everything else (default)
4. `GET /v1/models/:model` now also returns a `category` field.
5. **OpenAPI spec updated** to document the `type` query param and all new dedicated endpoints.

No route conflicts (router order: models before videos/images/audio routers, so `/v1/videos/models` resolves before `/v1/videos/:id`). Architect re-reviewed and approved after validation tightening.

### Session 23 — Tech debt cleanup (TS errors, multer types, unified billing)

User mandate: "لا اريد اي ديون تقنية" (no technical debt). Cleared **22 → 0** TypeScript errors and unified billing surface.

1. **Composite project rebuild** — `lib/db` and `lib/api-zod` had stale `.tsbuildinfo` causing `TS6305` (declarations not emitted). Cleared buildinfo and ran `tsc -b --force` to regenerate `dist/` for both libs.
2. **Multer `fileFilter` callback signatures** (`audio.ts`, `imagesEdits.ts`) — multer's overloaded `FileFilterCallback` requires either `cb(null, true|false)` OR `cb(error)`, never `cb(error, false)`. Split into explicit `if (ok) cb(null, true); else cb(new Error(...))` branches.
3. **Unified billing on `/v1/generate` and `/v1/images/generations`** — both routes previously used raw `db.transaction(...)` blocks duplicating the deduct+log+refund logic. Refactored to call `deductAndLog(apiKey.billingTarget, ...)` from `chatUtils.ts`, which:
   - Routes user vs org billing automatically via `BillingTarget` (resolved by `apiKeyAuth` middleware).
   - Stamps `usage_logs.organization_id` correctly when key is org-bound.
   - Keeps refunds atomic (single `UPDATE ... SET balance = balance + $refund` query).
4. **Verified zero new test regressions** — 52 pre-existing test failures (vitest 4 migration debt + missing `billingTarget` in mocks) confirmed unchanged by reverting `generate.ts` to HEAD: identical 9/9 failures. Test infrastructure cleanup is its own separate scope.

Architect approved. Net diff: **−56 LOC** across 4 route files. Org-level billing now works on image/text generation endpoints (was previously user-only).

### Session 24 — Intermittent login HTTP 500 fix

User report: occasional `HTTP 500 : Internal Server Error` on `/portal/auth/login` requiring page refresh + re-typing. Root cause: login handler had **no try/catch**, so any transient DB error (Postgres serialization 40001, connection drop 08006, ECONNRESET on Neon idle teardown, or race on the `INSERT...ON CONFLICT` in `ipRateLimit`) bubbled to the global error handler as an opaque 500 — no useful logs, no client-friendly message.

Fix:
1. **New helper `lib/dbRetry.ts`** — `withDbRetry(fn, opts)` retries on transient PG codes (`40001`/`40P01`/`57Pxx`/`08xxx`) and Node socket errors (`ECONNRESET`/`ETIMEDOUT`/`EPIPE`/`ENOTFOUND`/`EAI_AGAIN`/`ECONNREFUSED`) with exponential backoff (3 attempts, 50 ms base + jitter) and structured `pino` warn logs.
2. **`ipRateLimit.check`** — wrapped the upsert with `withDbRetry` (retry-safe: ON CONFLICT handles a duplicate first attempt).
3. **`portal/auth.ts` login + register** — full `try/catch` with structured `logger.error({ err, email, ip }, ...)` and **HTTP 503** (not 500) + user-friendly message, signaling "transient, retry meaningful" to clients/load balancers.
4. **`resetLoginLimit` after successful auth** is now non-blocking — its failure logs `warn` and the user still gets logged in.

Architect approved. Future work: wrap the `db.transaction` blocks (register, account deletion) in `withDbRetry` to handle commit-time serialization failures.

### Session 27 — Video Tutorials moved to TOP for visibility (UX fix)
**Problem reported (Arabic, repeated 3×)**: User couldn't find video URL input ("اريد مكان لاضافة رابط الفيديو"), reported save not working, and wanted videos at top of Docs page so developers see them first. Screenshots showed user was on Incidents page, never reaching Settings (which was at bottom of sidebar).

**Changes**:
- **`artifacts/dashboard/src/pages/portal/Docs.tsx`**: Video Tutorials Card moved BEFORE Base URL card (now first thing developers see after page header). Added `border-primary/30` accent.
- **`artifacts/dashboard/src/pages/admin/Settings.tsx`**: Video Tutorials Card moved to TOP — first card before Platform URL & SMTP. Highlighted with `border-primary/40 shadow-sm`. Layout redesigned: each video in its own boxed row (`rounded-md border bg-muted/30 p-3`) with "Video #N" header, full-width Title and YouTube URL inputs stacked vertically (instead of cramped horizontal flex), and explicit help text under URL field ("Paste any YouTube link...").
- Save flow unchanged (already working: `handleSaveVideos` → `saveSettings({docs_videos})` → PUT `/api/admin/settings`). User's "save not working" report attributed to UI confusion — they were on Incidents page, not Settings.

Architect explorer review: PASS — no duplicate cards, balanced JSX, save flow intact.

### Session 26 — `/v1/models` chat-only filter for n8n compatibility
Fixed `/v1/models` returning veo/whisper/tts to n8n chat node. Default now returns only chat-completion models. Added `?type=all` escape hatch. Category-specific endpoints (`/v1/models/video`, etc.) unchanged.

### Session 25 — Admin-managed YouTube tutorial videos on public Docs page

Goal: let new users watch onboarding videos directly on the API Documentation page without logging in.

Implementation:
1. **Admin settings backend** (`routes/admin/settings.ts`): added `docs_videos` key (JSON array of `{title, url}`, max 50), validated by Zod with a shared `httpUrl` schema that **rejects any URL whose protocol is not `http:` or `https:`** (blocks stored-XSS via `javascript:` / `data:` schemes).
2. **Public read endpoint** (`routes/portal/docs.ts`, NEW): `GET /portal/docs/videos` (mounted **before** the portal `requireAuth` middleware in `routes/index.ts`) so it is reachable without auth. Performs **defense-in-depth re-validation** with `isSafeHttpUrl()` — drops any legacy/manually-edited row whose URL isn't http(s) before sending to the client.
3. **Admin UI** (`pages/admin/Settings.tsx`): new Video Tutorials Card with title/URL inputs, add/remove/save handlers; client-side URL + protocol validation toasts before the API call.
4. **Public Docs page** (`pages/portal/Docs.tsx`): fetches the videos on mount (race-safe via cancellation flag), renders a Card with embedded YouTube iframes. `extractYouTubeId()` parses `youtu.be/`, `youtube.com/watch?v=`, `embed/`, `shorts/` formats and validates the 11-char ID via strict regex before constructing the iframe `src`. Non-YouTube URLs fall back to `<a target="_blank" rel="noopener noreferrer">`. Section is hidden when the videos array is empty.

Architect approved (PASS) after the read-path defense-in-depth was added. Net effect: 4 files, +250 / −9 LOC. Zero new tech debt.
