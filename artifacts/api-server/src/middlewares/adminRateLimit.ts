import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";

/**
 * Rate limiter for admin routes — 120 requests per 15 minutes per IP.
 * Protects against brute-force attacks on admin endpoints even if a JWT is compromised.
 */
export const adminRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP. Please try again later." },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "127.0.0.1"),
});

/**
 * Stricter rate limiter for admin auth endpoints — 20 attempts per 15 minutes per IP.
 */
export const adminAuthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "127.0.0.1"),
});

/**
 * Rate limiter for portal 2FA management endpoints — 30 attempts per 15 minutes per IP.
 * Mirrors the admin 2FA hardening: brute-force protection on verify/disable, plus
 * basic abuse protection on status/setup. Applied alongside `requireAuth` so an
 * authenticated session is still required.
 */
export const portalTwoFaRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many 2FA attempts. Please try again later." },
  keyGenerator: (req: Request) => ipKeyGenerator(req.ip ?? "127.0.0.1"),
});
