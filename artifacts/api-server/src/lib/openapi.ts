const spec = {
  openapi: "3.0.3",
  info: {
    title: "AI Gateway API",
    version: "1.0.0",
    description:
      "Production-grade API gateway proxying Google Vertex AI (Gemini, Imagen, Veo) and partner models (Grok, DeepSeek, Kimi, MiniMax, Gemma). Supports per-token billing, rate limiting, and content safety guardrails.",
    contact: { name: "AI Gateway Support", email: "support@yourdomain.com" },
  },
  servers: [{ url: "/api", description: "Current server" }],
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "JWT token obtained from /portal/auth/login or /admin/auth/login" },
      ApiKeyAuth: { type: "http", scheme: "bearer", description: "Developer API key (gw_ prefix) obtained from the developer portal" },
      CookieAuth: { type: "apiKey", in: "cookie", name: "auth_token", description: "httpOnly cookie set on login (alternative to Bearer token)" },
    },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string", example: "Invalid credentials" } } },
      User: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          email: { type: "string", format: "email" },
          name: { type: "string", example: "Jane Dev" },
          role: { type: "string", enum: ["admin", "developer"] },
          isActive: { type: "boolean" },
          emailVerified: { type: "boolean" },
          creditBalance: { type: "number", example: 10.5 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      ChatMessage: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["system", "user", "assistant"] },
          content: { oneOf: [{ type: "string" }, { type: "array", items: { type: "object" } }] },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["model", "messages"],
        properties: {
          model: { type: "string", example: "gemini-2.5-flash", description: "Use GET /v1/models to list available models." },
          messages: { type: "array", items: { "$ref": "#/components/schemas/ChatMessage" } },
          max_tokens: { type: "integer", example: 1024 },
          temperature: { type: "number", minimum: 0, maximum: 2, example: 0.7 },
          stream: { type: "boolean", default: false },
        },
      },
      ChatResponse: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string", example: "chat.completion" },
          created: { type: "integer" },
          model: { type: "string" },
          choices: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, message: { type: "object" }, finish_reason: { type: "string" } } } },
          usage: { type: "object", properties: { prompt_tokens: { type: "integer" }, completion_tokens: { type: "integer" }, total_tokens: { type: "integer" } } },
        },
      },
      Plan: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string", example: "Pro" },
          priceUsd: { type: "number", example: 49.0 },
          monthlyCredits: { type: "number", example: 100.0 },
          rpm: { type: "integer", example: 120 },
          isActive: { type: "boolean" },
        },
      },
    },
  },
  tags: [
    { name: "Health", description: "Server health check & Prometheus metrics" },
    { name: "Models", description: "List available AI models" },
    { name: "Chat", description: "OpenAI-compatible chat completions (Gemini, Grok, DeepSeek, etc.)" },
    { name: "Images", description: "Image generation via Imagen" },
    { name: "Video", description: "Video generation via Veo" },
    { name: "Portal Auth", description: "Developer portal authentication" },
    { name: "Portal Account", description: "Developer account management, API keys, usage" },
    { name: "Admin Auth", description: "Admin panel authentication" },
    { name: "Admin Users", description: "User management (admin only)" },
    { name: "Admin Plans", description: "Subscription plan management (admin only)" },
    { name: "Admin Analytics", description: "Platform analytics and statistics (admin only)" },
    { name: "Admin Model Costs", description: "Per-model pricing configuration (admin only)" },
  ],
  paths: {
    "/healthz": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        description: "Returns server status, uptime, and database connectivity.",
        responses: {
          "200": {
            description: "Server is healthy",
            content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", example: "ok" }, uptimeSeconds: { type: "number" }, db: { type: "object", properties: { ok: { type: "boolean" }, latencyMs: { type: "number" } } }, timestamp: { type: "string", format: "date-time" } } } } },
          },
        },
      },
    },
    "/metrics": {
      get: {
        tags: ["Health"],
        summary: "Prometheus metrics",
        description: "Returns request counters, error rates, and response latency in Prometheus text format.",
        responses: { "200": { description: "Metrics", content: { "text/plain": { schema: { type: "string" } } } } },
      },
    },
    "/v1/models": {
      get: {
        tags: ["Models"],
        summary: "List available models",
        description: "Returns all available AI models. Filter by capability with `?type=chat|image|video|audio|embedding`. For tools that require a stable per-category Base URL (e.g. n8n), the dedicated paths `/v1/chat/models`, `/v1/images/models`, `/v1/videos/models`, `/v1/audio/models`, `/v1/embeddings/models` return the same shape pre-filtered.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          { name: "type", in: "query", required: false, description: "Filter models by capability category.", schema: { type: "string", enum: ["chat", "image", "video", "audio", "embedding"] } },
        ],
        responses: {
          "200": {
            description: "List of models",
            content: { "application/json": { schema: { type: "object", properties: { object: { type: "string", example: "list" }, data: { type: "array", items: { type: "object", properties: { id: { type: "string" }, object: { type: "string" }, created: { type: "integer" }, owned_by: { type: "string" } } } } } } } },
          },
          "400": { description: "Invalid `type` query parameter", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/chat/completions": {
      post: {
        tags: ["Chat"],
        summary: "Chat completions (OpenAI-compatible)",
        description: "Generate chat completions. **Imagen and Veo models are blocked** — use /v1/images/generations and /v1/video/generations.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { "$ref": "#/components/schemas/ChatRequest" } } } },
        responses: {
          "200": { description: "Completion", content: { "application/json": { schema: { "$ref": "#/components/schemas/ChatResponse" } }, "text/event-stream": { schema: { type: "string" } } } },
          "400": { description: "Invalid request", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } } },
          "401": { description: "Invalid API key", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } } },
          "402": { description: "Insufficient credits", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } } },
          "429": { description: "Rate limit exceeded", content: { "application/json": { schema: { "$ref": "#/components/schemas/Error" } } } },
        },
      },
    },
    "/v1/images/generations": {
      post: {
        tags: ["Images"],
        summary: "Generate images (Imagen)",
        description: "Generate images using Google Imagen models. Only imagen-* model IDs are accepted.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["model", "prompt"], properties: { model: { type: "string", example: "imagen-3.0-generate-001" }, prompt: { type: "string" }, n: { type: "integer", minimum: 1, maximum: 4, default: 1 }, size: { type: "string", enum: ["1024x1024", "1024x1792", "1792x1024"], default: "1024x1024" } } },
            },
          },
        },
        responses: {
          "200": { description: "Generated images", content: { "application/json": { schema: { type: "object", properties: { created: { type: "integer" }, data: { type: "array", items: { type: "object", properties: { b64_json: { type: "string" }, revised_prompt: { type: "string" } } } } } } } } },
          "400": { description: "Invalid model (must be imagen-*)" },
          "401": { description: "Invalid API key" },
          "402": { description: "Insufficient credits" },
        },
      },
    },
    "/v1/video/generations": {
      post: {
        tags: ["Video"],
        summary: "Generate videos (Veo)",
        description: "Generate videos using Google Veo models. Only veo-* model IDs are accepted.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["model", "prompt"], properties: { model: { type: "string", example: "veo-2.0-generate-001" }, prompt: { type: "string" }, duration_seconds: { type: "integer", minimum: 5, maximum: 60, default: 5 }, aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], default: "16:9" } } },
            },
          },
        },
        responses: {
          "200": { description: "Video URI", content: { "application/json": { schema: { type: "object", properties: { created: { type: "integer" }, data: { type: "array", items: { type: "object", properties: { uri: { type: "string" } } } } } } } } },
          "400": { description: "Invalid model (must be veo-*)" },
        },
      },
    },
    "/portal/auth/register": {
      post: {
        tags: ["Portal Auth"],
        summary: "Register developer account",
        description: "Creates account, assigns free plan API key, sends verification email. Sets httpOnly cookie.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name", "email", "password"], properties: { name: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 } } } } } },
        responses: {
          "201": { description: "Account created", headers: { "Set-Cookie": { schema: { type: "string" }, description: "httpOnly auth_token cookie" } }, content: { "application/json": { schema: { type: "object", properties: { user: { "$ref": "#/components/schemas/User" }, apiKey: { type: "object" }, verificationEmailSent: { type: "boolean" } } } } } },
          "409": { description: "Email already registered" },
          "429": { description: "Too many registrations from this IP" },
        },
      },
    },
    "/portal/auth/login": {
      post: {
        tags: ["Portal Auth"],
        summary: "Developer login",
        description: "Sets httpOnly cookie and returns user data.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } } } } },
        responses: {
          "200": { description: "Login successful", headers: { "Set-Cookie": { schema: { type: "string" } } }, content: { "application/json": { schema: { type: "object", properties: { user: { "$ref": "#/components/schemas/User" } } } } } },
          "401": { description: "Invalid credentials" },
          "429": { description: "Too many login attempts" },
        },
      },
    },
    "/portal/auth/logout": {
      post: {
        tags: ["Portal Auth"],
        summary: "Developer logout",
        description: "Clears the auth_token cookie.",
        security: [{ CookieAuth: [] }],
        responses: { "200": { description: "Logged out" } },
      },
    },
    "/portal/auth/forgot-password": {
      post: {
        tags: ["Portal Auth"],
        summary: "Request password reset",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } } } } },
        responses: { "200": { description: "Reset email sent (always returns success to prevent enumeration)" } },
      },
    },
    "/portal/auth/reset-password": {
      post: {
        tags: ["Portal Auth"],
        summary: "Reset password",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["token", "password"], properties: { token: { type: "string" }, password: { type: "string", minLength: 8 } } } } } },
        responses: { "200": { description: "Password reset" }, "400": { description: "Invalid or expired token" } },
      },
    },
    "/portal/me": {
      get: {
        tags: ["Portal Account"],
        summary: "Get current user profile",
        description: "Returns user details, credit balance, API keys, plan info, and monthly usage stats.",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: {
          "200": { description: "User profile", content: { "application/json": { schema: { type: "object", properties: { user: { "$ref": "#/components/schemas/User" }, totalCreditsBalance: { type: "number" }, monthlyUsage: { type: "object" }, apiKeys: { type: "array" } } } } } },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/portal/usage": {
      get: {
        tags: ["Portal Account"],
        summary: "Usage history",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "model", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Usage logs" }, "401": { description: "Not authenticated" } },
      },
    },
    "/admin/auth/login": {
      post: {
        tags: ["Admin Auth"],
        summary: "Admin login",
        description: "Sets httpOnly cookie with admin JWT.",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } } } } },
        responses: {
          "200": { description: "Login successful", headers: { "Set-Cookie": { schema: { type: "string" } } }, content: { "application/json": { schema: { type: "object", properties: { user: { "$ref": "#/components/schemas/User" } } } } } },
          "401": { description: "Invalid credentials or not an admin" },
        },
      },
    },
    "/admin/auth/logout": {
      post: {
        tags: ["Admin Auth"],
        summary: "Admin logout",
        security: [{ CookieAuth: [] }],
        responses: { "200": { description: "Logged out" } },
      },
    },
    "/admin/users": {
      get: {
        tags: ["Admin Users"],
        summary: "List all users",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: "page", in: "query", schema: { type: "integer" } }, { name: "limit", in: "query", schema: { type: "integer" } }, { name: "search", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "Users list" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/plans": {
      get: { tags: ["Admin Plans"], summary: "List plans", security: [{ CookieAuth: [] }], responses: { "200": { description: "Plans", content: { "application/json": { schema: { type: "array", items: { "$ref": "#/components/schemas/Plan" } } } } } } },
      post: {
        tags: ["Admin Plans"],
        summary: "Create plan",
        security: [{ CookieAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name", "priceUsd", "monthlyCredits", "rpm"], properties: { name: { type: "string" }, priceUsd: { type: "number" }, monthlyCredits: { type: "number" }, rpm: { type: "integer" }, isActive: { type: "boolean" } } } } } },
        responses: { "201": { description: "Plan created" } },
      },
    },
    "/admin/analytics/stats": {
      get: { tags: ["Admin Analytics"], summary: "Platform statistics", security: [{ CookieAuth: [] }], responses: { "200": { description: "Stats" } } },
    },
    "/admin/model-costs": {
      get: { tags: ["Admin Model Costs"], summary: "List model pricing", security: [{ CookieAuth: [] }], responses: { "200": { description: "Model costs" } } },
    },

    // ── API key rotation (T10) ──────────────────────────────────────────────
    "/portal/api-keys/{id}/rotate": {
      post: {
        tags: ["Portal Account"],
        summary: "Rotate an API key",
        description: "Issues a new API key with the same plan/limits and grants the old key a 24-hour grace window (`expiresAt = now + 24h`). The plaintext of the new key is returned **once**.",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "201": { description: "Rotated", content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, fullKey: { type: "string", description: "Plain-text key — store securely." }, keyPrefix: { type: "string" }, rotatedFrom: { type: "integer" }, oldKeyExpiresAt: { type: "string", format: "date-time" } } } } } },
          "404": { description: "Key not found" },
          "409": { description: "Key is revoked" },
        },
      },
    },

    // ── GDPR data export (T04) ──────────────────────────────────────────────
    "/portal/me/export": {
      get: {
        tags: ["Portal Account"],
        summary: "Export account data (GDPR)",
        description: "Returns a ZIP archive containing your profile, API key metadata (no secrets), webhooks (no secrets), and the last 90 days of usage logs as JSON files.",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: {
          "200": { description: "ZIP archive", content: { "application/zip": { schema: { type: "string", format: "binary" } } } },
          "401": { description: "Not authenticated" },
        },
      },
    },

    // ── Webhook secret rotation (T01) ───────────────────────────────────────
    "/portal/webhooks/{id}/rotate-secret": {
      post: {
        tags: ["Portal Account"],
        summary: "Rotate a webhook signing secret",
        description: "Generates a new HMAC secret for the webhook. Existing in-flight requests signed with the old secret will fail verification once this returns.",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          "200": { description: "Updated webhook" },
          "404": { description: "Webhook not found" },
        },
      },
    },

    // ── Admin 2FA (T03) ─────────────────────────────────────────────────────
    "/admin/2fa/status": {
      get: {
        tags: ["Admin Auth"],
        summary: "Get 2FA status for current admin",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: { "200": { description: "Status", content: { "application/json": { schema: { type: "object", properties: { enabled: { type: "boolean" } } } } } } },
      },
    },
    "/admin/2fa/setup": {
      post: {
        tags: ["Admin Auth"],
        summary: "Begin 2FA setup",
        description: "Generates a new TOTP secret and returns a QR code as a data URL. 2FA stays disabled until `/admin/2fa/verify` succeeds.",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        responses: {
          "200": { description: "Provisioning data", content: { "application/json": { schema: { type: "object", properties: { secret: { type: "string" }, qrDataUrl: { type: "string" }, otpauthUrl: { type: "string" } } } } } },
          "409": { description: "2FA already enabled" },
        },
      },
    },
    "/admin/2fa/verify": {
      post: {
        tags: ["Admin Auth"],
        summary: "Verify TOTP code & enable 2FA",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string", pattern: "^[0-9]{6}$" } } } } } },
        responses: { "200": { description: "Enabled" }, "401": { description: "Invalid code" } },
      },
    },
    "/admin/2fa/disable": {
      post: {
        tags: ["Admin Auth"],
        summary: "Disable 2FA",
        security: [{ CookieAuth: [] }, { BearerAuth: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["code"], properties: { code: { type: "string" } } } } } },
        responses: { "200": { description: "Disabled" }, "401": { description: "Invalid code" } },
      },
    },
  },
};

export const openapiSpec = spec;
