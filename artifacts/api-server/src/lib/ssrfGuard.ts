/**
 * SSRF guard for outbound HTTP fetches (webhooks, link previews, etc).
 *
 * Rejects URLs that resolve to internal/private addresses to prevent
 * server-side request forgery against:
 *   - cloud metadata endpoints (e.g. 169.254.169.254)
 *   - internal services on RFC1918 networks
 *   - localhost / loopback
 *   - DNS rebinding (re-resolves at delivery time)
 *
 * Used both at user input time (registration) and at delivery time (every
 * outbound send) — re-resolving on each send is the only reliable defense
 * against rebinding attacks.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".corp",
  ".home",
  ".private",
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // unparseable → block
  const [a, b] = parts as [number, number, number, number];
  // 0.0.0.0/8 — "this network"
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 100.64.0.0/10 — carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.0.0.0/24, 192.0.2.0/24 (TEST-NET-1), 192.88.99.0/24, 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  // 198.18.0.0/15 (benchmarking), 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0) return true;
  // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved (incl. 255.255.255.255)
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 loopback, :: unspecified
  if (lower === "::1" || lower === "::") return true;
  // IPv4-mapped: ::ffff:a.b.c.d → check the v4 part
  const v4mapped = lower.match(/^::ffff:([0-9a-f.:]+)$/);
  if (v4mapped) {
    const v4 = v4mapped[1]!;
    if (net.isIPv4(v4)) return isPrivateIPv4(v4);
  }
  // fc00::/7 — unique local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // fe80::/10 — link-local
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // ff00::/8 — multicast
  if (lower.startsWith("ff")) return true;
  return false;
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown family → block
}

/**
 * Validate that a URL is safe to fetch from the server.
 * Throws SsrfBlockedError on any failure. On success returns the parsed URL.
 *
 * In production NODE_ENV, only `https:` is permitted. In development, `http:`
 * is allowed for non-private targets to ease local testing of public endpoints.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("URL is not a valid absolute URL");
  }

  const isProd = process.env.NODE_ENV === "production";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && !isProd)) {
    throw new SsrfBlockedError(
      `Only https:// URLs are allowed${isProd ? "" : " (http allowed in development)"}`,
    );
  }

  // Reject userinfo (`https://user:pass@host`) — auth in URL is a smuggling vector.
  if (parsed.username || parsed.password) {
    throw new SsrfBlockedError("URL must not contain credentials");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) throw new SsrfBlockedError("URL has no hostname");

  // Strip IPv6 brackets if present
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  // Hostname-level blocklist
  if (BLOCKED_HOSTNAMES.has(bareHost)) {
    throw new SsrfBlockedError(`Hostname "${bareHost}" is not allowed`);
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (bareHost === suffix.slice(1) || bareHost.endsWith(suffix)) {
      throw new SsrfBlockedError(`Hostname suffix "${suffix}" is not allowed`);
    }
  }

  // If host is a literal IP, check it directly.
  if (net.isIP(bareHost)) {
    if (isPrivateAddress(bareHost)) {
      throw new SsrfBlockedError(`IP address "${bareHost}" is private/internal`);
    }
    return parsed;
  }

  // Hostname → resolve all addresses; reject if ANY is private (defends against
  // multi-A-record attacks where one address is public and another is internal).
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(bareHost, { all: true });
  } catch {
    throw new SsrfBlockedError(`Failed to resolve hostname "${bareHost}"`);
  }
  if (addrs.length === 0) {
    throw new SsrfBlockedError(`Hostname "${bareHost}" has no DNS records`);
  }
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      throw new SsrfBlockedError(
        `Hostname "${bareHost}" resolves to private/internal address ${a.address}`,
      );
    }
  }
  return parsed;
}
