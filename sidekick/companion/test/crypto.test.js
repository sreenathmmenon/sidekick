import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { FieldCipher, NullCipher, isEncrypted } from "../src/crypto.js";

test("FieldCipher round-trips and produces opaque ciphertext", () => {
  const key = FieldCipher.deriveKey("a-master-secret-token", randomBytes(16));
  const cipher = new FieldCipher(key);
  const plaintext = "Maya asked: review the retry PR by Friday";

  const encrypted = cipher.encrypt(plaintext);
  assert.ok(isEncrypted(encrypted), "value should be tagged as encrypted");
  assert.ok(!encrypted.includes("Maya"), "ciphertext must not leak plaintext");
  assert.equal(cipher.decrypt(encrypted), plaintext);
});

test("FieldCipher passes legacy plaintext through unchanged on decrypt", () => {
  const cipher = new FieldCipher(FieldCipher.deriveKey("secret", randomBytes(16)));
  assert.equal(cipher.decrypt("not encrypted yet"), "not encrypted yet");
});

test("wrong key fails authentication", () => {
  const salt = randomBytes(16);
  const a = new FieldCipher(FieldCipher.deriveKey("token-a", salt));
  const b = new FieldCipher(FieldCipher.deriveKey("token-b", salt));
  const encrypted = a.encrypt("secret content");
  assert.throws(() => b.decrypt(encrypted));
});

test("NullCipher is a pass-through", () => {
  const cipher = new NullCipher();
  assert.equal(cipher.encrypt("x"), "x");
  assert.equal(cipher.decrypt("x"), "x");
});
