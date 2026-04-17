import { db, organizationsTable, organizationMembersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { ApiKeyWithRelations } from "../middlewares/apiKeyAuth";

export type OrgRole = "owner" | "admin" | "developer" | "viewer";

export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner:     4,
  admin:     3,
  developer: 2,
  viewer:    1,
};

export interface BillingTarget {
  targetType: "user" | "org";
  id: number;
  creditBalance: number;
  topupCreditBalance: number;
}

/**
 * Resolves which credit pool an API key bills against.
 * If the key has organizationId set, returns the org's pool.
 * Otherwise returns the user's pool (preserving legacy personal-account behavior).
 */
export async function resolveBillingTarget(apiKey: ApiKeyWithRelations): Promise<BillingTarget> {
  if (apiKey.organizationId) {
    const [org] = await db
      .select({
        id: organizationsTable.id,
        creditBalance: organizationsTable.creditBalance,
        topupCreditBalance: organizationsTable.topupCreditBalance,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, apiKey.organizationId))
      .limit(1);

    if (org) {
      return { targetType: "org", id: org.id, creditBalance: org.creditBalance, topupCreditBalance: org.topupCreditBalance };
    }
  }

  return {
    targetType: "user",
    id: apiKey.userId,
    creditBalance: apiKey.subscriptionCredit,
    topupCreditBalance: apiKey.topupCredit,
  };
}

/**
 * Returns the user's role inside the org, or null if not a member.
 * Owner of the org is always treated as 'owner' even if no membership row exists.
 */
export async function getUserOrgRole(orgId: number, userId: number): Promise<OrgRole | null> {
  const [org] = await db
    .select({ ownerId: organizationsTable.ownerId })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId))
    .limit(1);

  if (!org) return null;
  if (org.ownerId === userId) return "owner";

  const [membership] = await db
    .select({ role: organizationMembersTable.role })
    .from(organizationMembersTable)
    .where(and(
      eq(organizationMembersTable.organizationId, orgId),
      eq(organizationMembersTable.userId, userId),
    ))
    .limit(1);

  return (membership?.role as OrgRole | undefined) ?? null;
}

/**
 * Returns true if `actualRole` meets the minimum rank of any role in `requiredRoles`.
 */
export function hasOrgRole(actualRole: OrgRole | null, requiredRoles: OrgRole[]): boolean {
  if (!actualRole) return false;
  const minRank = Math.min(...requiredRoles.map((r) => ORG_ROLE_RANK[r]));
  return ORG_ROLE_RANK[actualRole] >= minRank;
}
