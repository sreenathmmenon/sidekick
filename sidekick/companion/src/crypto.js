import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Application-level field encryption for data at rest.
//
// node:sqlite has no SQLCipher binding, so rather than ship a native dependency
// we encrypt the sensitive *text* columns (event summaries, refs, derived
// content, provenance) with AES-256-GCM before they hit disk. Indexes and
// structural columns stay in clear so queries still work; only the
// human-readable payload is opaque on disk.
//
// Key derivation: scrypt(masterSecret, salt) where masterSecret is the API
// token (already keychain-backed) and salt is a per-database random value
// persisted next to the DB. This means the .sqlite file alone is not enough to
// read content — you also need the keychain secret.

const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:"; // tags ciphertext so we can detect/skip already-encrypted or legacy plaintext

export class FieldCipher {
  constructor(key) {
    this.key = key; // 32-byte Buffer
  }

  static deriveKey(masterSecret, salt) {
    return scryptSync(String(masterSecret), salt, 32);
  }

  encrypt(plaintext) {
    if (plaintext == null) return plaintext;
    const text = String(plaintext);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
  }

  decrypt(value) {
    if (typeof value !== "string" || !value.startsWith(PREFIX)) return value; // legacy plaintext passes through
    const raw = Buffer.from(value.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  }
}

// A no-op cipher used when encryption is disabled (SIDEKICK_ENCRYPT=false),
// so callers don't need conditional branches everywhere.
export class NullCipher {
  encrypt(v) { return v; }
  decrypt(v) { return v; }
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export { PREFIX as ENCRYPTION_PREFIX };
