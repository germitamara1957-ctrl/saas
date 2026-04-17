import { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { verifyToken, type TokenPayload } from "../lib/jwt";

declare global {
  namespace Express {
    interface Request {
      authUser?: TokenPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  // 1. httpOnly cookie (preferred — not accessible to JS)
  if (req.cookies?.auth_token) {
    return req.cookies.auth_token as string;
  }
  // 2. Authorization: Bearer <token> header (backward compatibility, API clients)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let payload: TokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  if (payload.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const [user] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, parseInt(payload.sub, 10)))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Account is disabled" });
    return;
  }

  req.authUser = payload;
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  let payload: TokenPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const [user] = await db
    .select({ isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, parseInt(payload.sub, 10)))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Account is disabled" });
    return;
  }

  req.authUser = payload;
  next();
}
