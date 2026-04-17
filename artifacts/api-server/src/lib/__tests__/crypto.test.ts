import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateApiKey, hashApiKey, encryptApiKey, decryptApiKey } from "../crypto";

describe("hashPassword / verifyPassword", () => {
  it("hashes a password and verifies it correctly", async () => {
    const password = "S3cur3P@ssw0rd!";
    const hash = await hashPassword(password);
    expect(hash).not.toBe(password);
    expect(hash.length).toBeGreaterThan(20);
    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correctPassword");
    const valid = await verifyPassword("wrongPassword", hash);
    expect(valid).toBe(false);
  });

  it("produces different hashes for the same password (salted)", async () => {
    const password = "samePassword";
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
  });
});

describe("generateApiKey / hashApiKey", () => {
  it("generates a key with the expected structure", () => {
    const { rawKey, keyHash, keyPrefix } = generateApiKey();
    expect(typeof rawKey).toBe("string");
    expect(rawKey.length).toBeGreaterThan(20);
    expect(typeof keyHash).toBe("string");
    expect(keyHash.length).toBeGreaterThan(0);
    expect(typeof keyPrefix).toBe("string");
    expect(keyPrefix.endsWith("...")).toBe(true);
  });

  it("hashing the same raw key always produces the same hash", () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(hashApiKey(rawKey)).toBe(keyHash);
  });

  it("two generated keys are unique", () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.rawKey).not.toBe(key2.rawKey);
    expect(key1.keyHash).not.toBe(key2.keyHash);
  });
});

describe("encryptApiKey / decryptApiKey", () => {
  it("encrypts and decrypts correctly", () => {
    const secret = "sk-test-api-key-12345";
    const encrypted = encryptApiKey(secret);
    expect(encrypted).not.toBe(secret);
    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(secret);
  });

  it("two encryptions of the same value produce different ciphertexts (random IV)", () => {
    const value = "same-value";
    const enc1 = encryptApiKey(value);
    const enc2 = encryptApiKey(value);
    expect(enc1).not.toBe(enc2);
    expect(decryptApiKey(enc1)).toBe(value);
    expect(decryptApiKey(enc2)).toBe(value);
  });
});
