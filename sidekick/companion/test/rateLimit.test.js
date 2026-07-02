import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/rateLimit.js";

test("RateLimiter allows up to the cap then blocks", () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
  const now = 1000;
  assert.equal(limiter.check("client", now).allowed, true);
  assert.equal(limiter.check("client", now).allowed, true);
  assert.equal(limiter.check("client", now).allowed, true);
  const blocked = limiter.check("client", now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test("RateLimiter resets after the window", () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
  assert.equal(limiter.check("c", 1000).allowed, true);
  assert.equal(limiter.check("c", 1000).allowed, false);
  assert.equal(limiter.check("c", 2001).allowed, true);
});

test("RateLimiter keys clients independently", () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 1 });
  assert.equal(limiter.check("a", 1000).allowed, true);
  assert.equal(limiter.check("b", 1000).allowed, true);
  assert.equal(limiter.check("a", 1000).allowed, false);
});
