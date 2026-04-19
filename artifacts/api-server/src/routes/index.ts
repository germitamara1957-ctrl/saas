import { Router, type IRouter } from "express";
import healthRouter from "./health";

import adminAuthRouter from "./admin/auth";
import adminProvidersRouter from "./admin/providers";
import adminPlansRouter from "./admin/plans";
import adminUsersRouter from "./admin/users";
import adminApiKeysRouter from "./admin/apiKeys";
import adminAnalyticsRouter from "./admin/analytics";
import adminModelCostsRouter from "./admin/modelCosts";
import adminAuditLogRouter from "./admin/auditLog";
import adminPromoCodesRouter from "./admin/promoCodes";
import adminSettingsRouter from "./admin/settings";
import adminTwoFaRouter from "./admin/twofa";
import portalTwoFaRouter from "./portal/twofa";
import adminIncidentsRouter from "./admin/incidents";
import adminReferralsRouter from "./admin/referrals";

import portalAuthRouter from "./portal/auth";
import portalMeRouter from "./portal/me";
import portalUsageRouter from "./portal/usage";
import portalPromoCodesRouter from "./portal/promoCodes";
import portalWebhooksRouter from "./portal/webhooks";
import portalLogsRouter from "./portal/logs";
import portalOrganizationsRouter from "./portal/organizations";
import portalDocsRouter from "./portal/docs";
import portalBillingRouter from "./portal/billing";
import portalReferralsRouter from "./portal/referrals";
import adminChargilyRouter from "./admin/chargily";
import chargilyWebhookRouter from "./webhooks/chargily";

import statusRouter from "./status";

import v1ChatRouter from "./v1/chat";
import v1ResponsesRouter from "./v1/responses";
import v1GenerateRouter from "./v1/generate";
import v1ImagesRouter from "./v1/images";
import v1ImagesEditsRouter from "./v1/imagesEdits";
import v1AudioRouter from "./v1/audio";
import v1VideoRouter from "./v1/video";
import v1VideosRouter from "./v1/videos";
import v1ModelsRouter from "./v1/models";
import v1FilesRouter from "./v1/files";
import v1EmbeddingsRouter from "./v1/embeddings";

import { requireAdmin, requireAuth } from "../middlewares/adminAuth";
import { adminRateLimit, adminAuthRateLimit, portalTwoFaRateLimit } from "../middlewares/adminRateLimit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(statusRouter);

// Admin routes — login is public (but rate-limited), everything else requires admin JWT + rate limit
router.use("/admin/auth", adminAuthRateLimit);
router.use(adminAuthRouter);
router.use("/admin/providers", adminRateLimit, requireAdmin);
router.use("/admin/plans", adminRateLimit, requireAdmin);
router.use("/admin/users", adminRateLimit, requireAdmin);
router.use("/admin/api-keys", adminRateLimit, requireAdmin);
router.use("/admin/analytics", adminRateLimit, requireAdmin);
router.use("/admin/model-costs", adminRateLimit, requireAdmin);
router.use("/admin/audit-log", adminRateLimit, requireAdmin);
router.use("/admin/promo-codes", adminRateLimit, requireAdmin);
router.use("/admin/settings", adminRateLimit, requireAdmin);
router.use("/admin/incidents", adminRateLimit, requireAdmin);
router.use("/admin/2fa", adminRateLimit, requireAdmin);
router.use("/admin/billing", adminRateLimit, requireAdmin);
router.use("/admin/referrals", adminRateLimit, requireAdmin);
router.use(adminProvidersRouter);
router.use(adminPlansRouter);
router.use(adminUsersRouter);
router.use(adminApiKeysRouter);
router.use(adminAnalyticsRouter);
router.use(adminModelCostsRouter);
router.use(adminAuditLogRouter);
router.use(adminPromoCodesRouter);
router.use(adminSettingsRouter);
router.use(adminIncidentsRouter);
router.use(adminTwoFaRouter);
router.use(adminChargilyRouter);
router.use(adminReferralsRouter);

// Portal routes — login is public, /me /api-keys /usage require portal JWT
router.use(portalAuthRouter);
router.use(portalDocsRouter); // public — videos shown on /docs page for new users
router.use("/portal/2fa", portalTwoFaRateLimit, requireAuth, portalTwoFaRouter);
router.use("/portal/me", requireAuth);
router.use("/portal/api-keys", requireAuth);
router.use("/portal/usage", requireAuth);
router.use("/portal/plans", requireAuth);
router.use("/portal/promo-codes", requireAuth);
router.use("/portal/webhooks", requireAuth);
router.use("/portal/logs", requireAuth);
router.use("/portal/organizations", requireAuth);
router.use("/portal/billing", requireAuth);
router.use("/portal/referrals", requireAuth);
router.use(portalMeRouter);
router.use(portalUsageRouter);
router.use(portalPromoCodesRouter);
router.use(portalWebhooksRouter);
router.use(portalLogsRouter);
router.use(portalOrganizationsRouter);
router.use(portalBillingRouter);
router.use(portalReferralsRouter);

// Webhook receivers (no auth — verified via HMAC inside the handler).
router.use(chargilyWebhookRouter);

// V1 proxy routes — api key auth is applied inline per route
import { captureRequestResponse } from "../middlewares/logCapture";
import { idempotency } from "../middlewares/idempotency";
router.use("/v1", captureRequestResponse);
// Idempotency runs *after* apiKeyAuth (mounted inline per route) so it can
// scope cache keys to (apiKeyId, idempotencyKey). When called before auth, it
// no-ops and forwards. Mount it here so it sees req.apiKey set by per-route auth.
router.use("/v1", idempotency);
router.use(v1ModelsRouter);
router.use(v1ChatRouter);
router.use(v1ResponsesRouter);
router.use(v1GenerateRouter);
router.use(v1ImagesRouter);
router.use(v1ImagesEditsRouter);
router.use(v1AudioRouter);
router.use(v1VideoRouter);
router.use(v1VideosRouter);
router.use(v1FilesRouter);
router.use(v1EmbeddingsRouter);

export default router;
