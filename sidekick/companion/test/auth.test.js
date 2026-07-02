import test from "node:test";
import assert from "node:assert/strict";
import { requireBearerToken } from "../src/auth.js";

test("requireBearerToken accepts exact bearer token", () => {
  assert.equal(
    requireBearerToken(
      {
        headers: {
          authorization: "Bearer test-token"
        }
      },
      "test-token"
    ),
    true
  );
});

test("requireBearerToken rejects missing or incorrect bearer token", () => {
  assert.equal(requireBearerToken({ headers: {} }, "test-token"), false);
  assert.equal(
    requireBearerToken(
      {
        headers: {
          authorization: "Bearer wrong-token"
        }
      },
      "test-token"
    ),
    false
  );
});
