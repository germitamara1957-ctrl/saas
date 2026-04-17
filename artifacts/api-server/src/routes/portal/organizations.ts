import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { eq, and, or, desc, sql, isNull } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationMembersTable,
  organizationInvitesTable,
  usersTable,
  apiKeysTable,
  plansTable,
} from "@workspace/db";
import { asc } from "drizzle-orm";
import { getUserOrgRole, hasOrgRole, type OrgRole } from "../../lib/orgUtils";
import { generateApiKey, encryptApiKey } from "../../lib/crypto";

const router: IRouter = Router();

const VALID_ROLES: OrgRole[] = ["owner", "admin", "developer", "viewer"];

function getUserId(req: { authUser?: { sub: string } }): number {
  return Number(req.authUser!.sub);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org";
}

// ─── List my organizations ──────────────────────────────────────────────────
router.get("/portal/organizations", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const rows = await db
    .select({
      org: organizationsTable,
      role: sql<string>`COALESCE(${organizationMembersTable.role}, CASE WHEN ${organizationsTable.ownerId} = ${userId} THEN 'owner' ELSE NULL END)`,
    })
    .from(organizationsTable)
    .leftJoin(
      organizationMembersTable,
      and(
        eq(organizationMembersTable.organizationId, organizationsTable.id),
        eq(organizationMembersTable.userId, userId),
      ),
    )
    .where(or(
      eq(organizationsTable.ownerId, userId),
      eq(organizationMembersTable.userId, userId),
    ))
    .orderBy(desc(organizationsTable.createdAt));

  res.json({ organizations: rows.filter((r) => r.role).map((r) => ({ ...r.org, role: r.role })) });
});

// ─── Create organization ────────────────────────────────────────────────────
router.post("/portal/organizations", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const name = String(req.body?.name ?? "").trim();
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  // Insert with unique slug — handle race conditions via PG unique-violation retry
  let org: typeof organizationsTable.$inferSelect | undefined;
  const baseSlug = slugify(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomBytes(2).toString("hex")}`;
    try {
      [org] = await db.insert(organizationsTable).values({ name, slug, ownerId: userId }).returning();
      break;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err; // not unique violation → rethrow
      // else continue to next attempt with a new suffix
    }
  }
  if (!org) { res.status(409).json({ error: "Could not allocate a unique slug; please try a different name" }); return; }
  await db.insert(organizationMembersTable).values({ organizationId: org!.id, userId, role: "owner" }).onConflictDoNothing();

  res.status(201).json({ organization: { ...org, role: "owner" } });
});

// ─── Org details ────────────────────────────────────────────────────────────
router.get("/portal/organizations/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!role) { res.status(404).json({ error: "Organization not found" }); return; }

  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!org) { res.status(404).json({ error: "Organization not found" }); return; }

  // Members: include implicit owner row (even if missing from members table)
  const members = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: organizationMembersTable.role,
      createdAt: organizationMembersTable.createdAt,
    })
    .from(organizationMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, organizationMembersTable.userId))
    .where(eq(organizationMembersTable.organizationId, orgId));

  if (!members.find((m) => m.userId === org.ownerId)) {
    const [ownerUser] = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, org.ownerId)).limit(1);
    if (ownerUser) {
      members.unshift({ userId: ownerUser.id, email: ownerUser.email, name: ownerUser.name, role: "owner", createdAt: org.createdAt });
    }
  }

  res.json({ organization: { ...org, role }, members });
});

// ─── Rename ─────────────────────────────────────────────────────────────────
router.patch("/portal/organizations/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const name = String(req.body?.name ?? "").trim();
  if (!name) { res.status(400).json({ error: "Name is required" }); return; }

  const [org] = await db.update(organizationsTable).set({ name }).where(eq(organizationsTable.id, orgId)).returning();
  res.json({ organization: org });
});

// ─── Delete (owner only) ────────────────────────────────────────────────────
router.delete("/portal/organizations/:id", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (role !== "owner") { res.status(403).json({ error: "Only the owner can delete the organization" }); return; }

  await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
  res.status(204).end();
});

// ─── Invites: list ──────────────────────────────────────────────────────────
router.get("/portal/organizations/:id/invites", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const invites = await db
    .select()
    .from(organizationInvitesTable)
    .where(and(eq(organizationInvitesTable.organizationId, orgId), isNull(organizationInvitesTable.acceptedAt)))
    .orderBy(desc(organizationInvitesTable.createdAt));

  res.json({ invites });
});

// ─── Invites: create ────────────────────────────────────────────────────────
router.post("/portal/organizations/:id/invites", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const inviteRole = String(req.body?.role ?? "developer") as OrgRole;
  if (!email || !email.includes("@")) { res.status(400).json({ error: "Valid email required" }); return; }
  if (!VALID_ROLES.includes(inviteRole) || inviteRole === "owner") { res.status(400).json({ error: "Invalid role" }); return; }

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    const [invite] = await db.insert(organizationInvitesTable).values({
      organizationId: orgId, email, role: inviteRole, token, invitedById: userId, expiresAt,
    }).returning();
    res.status(201).json({ invite });
  } catch {
    res.status(409).json({ error: "An invite for this email already exists in this organization" });
  }
});

// ─── Invites: revoke ────────────────────────────────────────────────────────
router.delete("/portal/organizations/:id/invites/:inviteId", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  const inviteId = Number(req.params.inviteId);
  if (!Number.isFinite(orgId) || !Number.isFinite(inviteId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(organizationInvitesTable).where(and(
    eq(organizationInvitesTable.id, inviteId),
    eq(organizationInvitesTable.organizationId, orgId),
  ));
  res.status(204).end();
});

// ─── Invites: accept (must be authenticated; matches by token + email) ──────
router.post("/portal/organizations/invites/:token/accept", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const token = String(req.params.token);

  const [invite] = await db.select().from(organizationInvitesTable).where(eq(organizationInvitesTable.token, token)).limit(1);
  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }
  if (invite.acceptedAt) { res.status(410).json({ error: "Invite already accepted" }); return; }
  if (invite.expiresAt < new Date()) { res.status(410).json({ error: "Invite expired" }); return; }

  const [user] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(401).json({ error: "User not found" }); return; }
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    res.status(403).json({ error: "Invite was sent to a different email address" });
    return;
  }

  await db.insert(organizationMembersTable).values({
    organizationId: invite.organizationId, userId, role: invite.role,
  }).onConflictDoUpdate({
    target: [organizationMembersTable.organizationId, organizationMembersTable.userId],
    set: { role: invite.role },
  });

  await db.update(organizationInvitesTable).set({ acceptedAt: new Date() }).where(eq(organizationInvitesTable.id, invite.id));

  res.json({ ok: true, organizationId: invite.organizationId });
});

// ─── Members: change role ───────────────────────────────────────────────────
router.patch("/portal/organizations/:id/members/:userId", async (req, res): Promise<void> => {
  const actorId = getUserId(req);
  const orgId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  if (!Number.isFinite(orgId) || !Number.isFinite(targetUserId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, actorId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const newRole = String(req.body?.role ?? "") as OrgRole;
  if (!VALID_ROLES.includes(newRole) || newRole === "owner") { res.status(400).json({ error: "Invalid role" }); return; }

  const [org] = await db.select({ ownerId: organizationsTable.ownerId }).from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }
  if (org.ownerId === targetUserId) { res.status(403).json({ error: "Cannot change role of organization owner" }); return; }

  const [updated] = await db.update(organizationMembersTable).set({ role: newRole }).where(and(
    eq(organizationMembersTable.organizationId, orgId),
    eq(organizationMembersTable.userId, targetUserId),
  )).returning();

  if (!updated) { res.status(404).json({ error: "Member not found" }); return; }
  res.json({ member: updated });
});

// ─── Members: remove ────────────────────────────────────────────────────────
router.delete("/portal/organizations/:id/members/:userId", async (req, res): Promise<void> => {
  const actorId = getUserId(req);
  const orgId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  if (!Number.isFinite(orgId) || !Number.isFinite(targetUserId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, actorId);
  // Allow self-removal as well
  const isSelf = actorId === targetUserId;
  if (!isSelf && !hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const [org] = await db.select({ ownerId: organizationsTable.ownerId }).from(organizationsTable).where(eq(organizationsTable.id, orgId)).limit(1);
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }
  if (org.ownerId === targetUserId) { res.status(403).json({ error: "Cannot remove the organization owner" }); return; }

  await db.delete(organizationMembersTable).where(and(
    eq(organizationMembersTable.organizationId, orgId),
    eq(organizationMembersTable.userId, targetUserId),
  ));
  res.status(204).end();
});

// ─── Org API keys: list (any member) ────────────────────────────────────────
router.get("/portal/organizations/:id/api-keys", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!role) { res.status(404).json({ error: "Organization not found" }); return; }

  const keys = await db
    .select({
      id: apiKeysTable.id,
      name: apiKeysTable.name,
      keyPrefix: apiKeysTable.keyPrefix,
      isActive: apiKeysTable.isActive,
      lastUsedAt: apiKeysTable.lastUsedAt,
      createdAt: apiKeysTable.createdAt,
      createdByUserId: apiKeysTable.userId,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.organizationId, orgId))
    .orderBy(desc(apiKeysTable.createdAt));

  res.json({ apiKeys: keys });
});

// ─── Org API keys: create (owner/admin) ─────────────────────────────────────
// The created key debits the org credit pool; it is scoped via `organization_id`.
// `userId` records the human creator (for audit) — the key itself is org-owned.
router.post("/portal/organizations/:id/api-keys", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Only owners and admins can create org API keys" }); return; }

  const rawName = req.body?.name;
  if (rawName !== undefined && (typeof rawName !== "string" || rawName.length > 100)) {
    res.status(400).json({ error: "name must be a string of at most 100 characters" });
    return;
  }
  const keyName = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "Org Key";

  // Org keys still need a plan attached (rate-limit + model-list gating in
  // apiKeyAuth assumes one). Use the creator's current plan, or fall back to
  // the cheapest active plan. Org keys never receive plan-bonus credits.
  const [creator] = await db.select({ currentPlanId: usersTable.currentPlanId })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  let planId: number | null = creator?.currentPlanId ?? null;
  if (planId == null) {
    const [fallback] = await db.select({ id: plansTable.id })
      .from(plansTable).where(eq(plansTable.isActive, true))
      .orderBy(asc(plansTable.priceUsd)).limit(1);
    planId = fallback?.id ?? null;
  }
  if (planId == null) {
    res.status(409).json({ error: "No active plan available to assign to the org key. Contact your administrator." });
    return;
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey();
  const keyEncrypted = encryptApiKey(rawKey);

  const [apiKey] = await db.insert(apiKeysTable).values({
    userId,                  // human creator (audit only)
    organizationId: orgId,   // billing target — debits org pool, not user
    planId,                  // rate-limit & allowed-models gating only
    keyPrefix, keyHash, keyEncrypted,
    name: keyName,
    isActive: true,
  }).returning();

  res.status(201).json({
    id: apiKey!.id,
    keyPrefix: apiKey!.keyPrefix,
    fullKey: rawKey,
    name: apiKey!.name,
    isActive: apiKey!.isActive,
    createdAt: apiKey!.createdAt,
  });
});

// ─── Org API keys: revoke (owner/admin) ─────────────────────────────────────
router.delete("/portal/organizations/:id/api-keys/:keyId", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  const keyId = Number(req.params.keyId);
  if (!Number.isFinite(orgId) || !Number.isFinite(keyId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  // Scope by both org and key id to prevent cross-org revocation.
  const [updated] = await db.update(apiKeysTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(and(eq(apiKeysTable.id, keyId), eq(apiKeysTable.organizationId, orgId)))
    .returning({ id: apiKeysTable.id });

  if (!updated) { res.status(404).json({ error: "API key not found in this organization" }); return; }
  res.status(204).end();
});

// ─── Org spending limits (owner/admin) ──────────────────────────────────────
// PATCH body: { dailySpendLimitUsd?: number|null, monthlySpendLimitUsd?: number|null }
// Pass `null` to clear a cap. Omit a field to leave it unchanged.
router.patch("/portal/organizations/:id/spending-limits", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const role = await getUserOrgRole(orgId, userId);
  if (!hasOrgRole(role, ["owner", "admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const updates: Partial<{ dailySpendLimitUsd: number | null; monthlySpendLimitUsd: number | null }> = {};

  for (const field of ["dailySpendLimitUsd", "monthlySpendLimitUsd"] as const) {
    if (field in (req.body ?? {})) {
      const v = req.body[field];
      if (v === null) {
        updates[field] = null;
      } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
        updates[field] = v;
      } else {
        res.status(400).json({ error: `${field} must be a non-negative number or null` });
        return;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [org] = await db.update(organizationsTable)
    .set(updates)
    .where(eq(organizationsTable.id, orgId))
    .returning({
      id: organizationsTable.id,
      dailySpendLimitUsd: organizationsTable.dailySpendLimitUsd,
      monthlySpendLimitUsd: organizationsTable.monthlySpendLimitUsd,
    });

  res.json({ organization: org });
});

export default router;
