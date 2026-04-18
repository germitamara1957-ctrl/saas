import crypto from "crypto";

// Fail-fast at module load time so the server never starts without the key.
// Tests provide ENCRYPTION_KEY via setup; never silently fall back to JWT_SECRET.
if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}

const CIPHER_ALGORITHM = "aes-256-gcm";

const SCRYPT_N_LEGACY = 16384;
// N=65536 requires 64MB RAM per hash — exceeds OpenSSL memory limits in some hosted environments.
// N=32768 requires 32MB and is still cryptographically strong (well above NIST recommendation of N=16384).
// Use SCRYPT_N env var to override (e.g. for testing). Verifying old hashes still works because N is stored in the hash itself.
const SCRYPT_N_CURRENT =
  process.env.NODE_ENV === "test"
    ? 1024
    : parseInt(process.env.SCRYPT_N ?? "32768", 10);

/**
 * Returns the primary encryption key derived from ENCRYPTION_KEY env var.
 * This key is used for ALL new encryptions.
 *
 * ENCRYPTION_KEY is REQUIRED — there is no fallback for new encryptions.
 * (For backward-compatible decryption of legacy data, see `getLegacyKey()`.)
 */
function getPrimaryKey(): Buffer {
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) {
    throw new Error("ENCRYPTION_KEY environment variable is required for encryption");
  }
  return crypto.createHash("sha256").update(encKey).digest();
}

/**
 * Returns the legacy key derived from JWT_SECRET only.
 * Used as a fallback during DECRYPTION ONLY for data encrypted before
 * ENCRYPTION_KEY was introduced. Never used for new encryptions.
 */
function getLegacyKey(): Buffer | null {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return null;
  return crypto.createHash("sha256").update(jwtSecret).digest();
}

function tryDecrypt(key: Buffer, ivHex: string, encryptedHex: string, authTagHex: string): string | null {
  try {
    const iv = Buffer.from(ivHex, "hex");
    const encryptedBuffer = Buffer.from(encryptedHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    // GCM auth tag MUST be exactly 16 bytes (128-bit). Reject shorter tags to
    // prevent authentication-tag truncation attacks (GHSA-gcm-no-tag-length).
    if (iv.length !== 12 || authTag.length !== 16) return null;
    const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedBuffer).toString("utf8") + decipher.final("utf8");
  } catch {
    return null;
  }
}

export function encryptApiKey(rawKey: string): string {
  const key = getPrimaryKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(rawKey, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

export function decryptApiKey(encryptedData: string): string | null {
  const parts = encryptedData.split(":");
  if (parts.length !== 3) return null;
  const [ivHex, encryptedHex, authTagHex] = parts as [string, string, string];

  // Try primary key first (ENCRYPTION_KEY or JWT_SECRET fallback)
  const primary = getPrimaryKey();
  const result = tryDecrypt(primary, ivHex, encryptedHex, authTagHex);
  if (result !== null) return result;

  // Backward compatibility: try JWT_SECRET for data encrypted before
  // ENCRYPTION_KEY was introduced.
  const legacy = getLegacyKey();
  if (legacy) {
    return tryDecrypt(legacy, ivHex, encryptedHex, authTagHex);
  }

  return null;
}

/**
 * Hash a password using scrypt with N=65536.
 * Format: `salt:N:derivedKeyHex`
 * Older hashes use format `salt:derivedKeyHex` (N=16384, implicit).
 */
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, { N: SCRYPT_N_CURRENT }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${SCRYPT_N_CURRENT}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Verify a password against a stored hash.
 * Supports both the new 3-part format (`salt:N:hash`) and the legacy 2-part format (`salt:hash`).
 */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const parts = hash.split(":");
    let salt: string;
    let key: string;
    let N: number;

    if (parts.length === 3) {
      [salt, , key] = parts as [string, string, string];
      N = Number(parts[1]) || SCRYPT_N_LEGACY;
    } else if (parts.length === 2) {
      [salt, key] = parts as [string, string];
      N = SCRYPT_N_LEGACY;
    } else {
      resolve(false);
      return;
    }

    if (!salt || !key) {
      resolve(false);
      return;
    }

    crypto.scrypt(password, salt, 64, { N }, (err, derivedKey) => {
      if (err) reject(err);
      else {
        try {
          resolve(crypto.timingSafeEqual(Buffer.from(key, "hex"), derivedKey));
        } catch {
          resolve(false);
        }
      }
    });
  });
}

export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `sk-${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.substring(0, 12) + "...";
  return { rawKey, keyHash, keyPrefix };
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}
