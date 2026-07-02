import { logger } from "./logger.js";
import { syncGitHub } from "./github.js";
import { readSecret } from "./secrets.js";

// Background connector polling. Turns Sidekick from a dashboard you must remember
// to open into an assistant that surfaces review-requests and assignments on its
// own — the council's "invisible by default" retention fix.
//
// Design constraints:
//   - Only runs when a token is actually stored (no token => silent no-op).
//   - Never throws into the event loop: every cycle is fully guarded, so a GitHub
//     outage or bad token can never crash the companion.
//   - timer.unref() so it never keeps the process alive during shutdown.
//   - Disposable: stop() clears the interval.

export class ConnectorPoller {
  constructor({ store, deriveFn, intervalMs, runImmediately = true, deps = {} }) {
    this.store = store;
    this.deriveFn = deriveFn;
    this.intervalMs = intervalMs;
    this.runImmediately = runImmediately;
    this.readSecret = deps.readSecret || readSecret;
    this.syncGitHub = deps.syncGitHub || syncGitHub;
    this.fetchImpl = deps.fetch; // optional, for tests
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.intervalMs <= 0) {
      logger.info("connector polling disabled", { intervalMs: this.intervalMs });
      return;
    }
    logger.info("connector polling enabled", { intervalMs: this.intervalMs });
    if (this.runImmediately) {
      // Defer the first run a tick so startup logging stays clean.
      setTimeout(() => this.runOnce(), 50).unref?.();
    }
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // One fully-guarded polling cycle. Returns a small summary (handy for tests);
  // never rejects.
  async runOnce() {
    if (this.running) return { skipped: "already running" }; // avoid overlap on slow networks
    this.running = true;
    try {
      const token = this.readSecret("github-pat");
      if (!token) return { skipped: "no github token" };

      const result = await this.syncGitHub(
        { token, includeReviewRequests: true, includeAssigned: true },
        this.store,
        this.deriveFn,
        this.fetchImpl ? { fetch: this.fetchImpl } : {}
      );
      if (result.imported > 0) {
        logger.info("github poll imported items", { imported: result.imported });
      }
      if (result.errors?.length) {
        logger.warn("github poll had source errors", { errors: result.errors.map((e) => e.source) });
      }
      return { imported: result.imported, errors: result.errors?.length || 0 };
    } catch (error) {
      // A poll failure must never take down the companion.
      logger.warn("github poll failed", { error: error.message });
      return { error: error.message };
    } finally {
      this.running = false;
    }
  }
}
