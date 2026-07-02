// Fixed-window in-memory rate limiter, keyed by client. Zero dependencies.
//
// The companion binds to loopback, but any local process can reach the API with
// the token. A simple per-client request cap blunts runaway clients or a
// compromised local process hammering the capability endpoints. Windows are
// pruned lazily so memory stays bounded without a timer.

export class RateLimiter {
  constructor({ windowMs = 10_000, maxRequests = 240 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.buckets = new Map(); // key -> { count, resetAt }
  }

  check(key, now = Date.now()) {
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
      this.prune(now);
    }
    bucket.count += 1;
    if (bucket.count > this.maxRequests) {
      return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    return { allowed: true, remaining: this.maxRequests - bucket.count };
  }

  prune(now) {
    if (this.buckets.size < 1024) return;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}
