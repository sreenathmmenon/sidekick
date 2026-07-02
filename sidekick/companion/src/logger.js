// Minimal structured, leveled logger. Zero dependencies.
// Emits single-line JSON to stdout/stderr so logs are greppable and machine-parseable,
// while staying readable in a terminal. Honours SIDEKICK_LOG_LEVEL.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

function resolveLevel(env = process.env) {
  const raw = String(env.SIDEKICK_LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] != null ? raw : "info";
}

let activeLevel = resolveLevel();

export function setLogLevel(level) {
  if (LEVELS[level] != null) activeLevel = level;
}

function emit(level, message, fields) {
  if (LEVELS[level] < LEVELS[activeLevel]) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(fields && typeof fields === "object" ? fields : {})
  };
  const line = JSON.stringify(record);
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg, fields) => emit("debug", msg, fields),
  info: (msg, fields) => emit("info", msg, fields),
  warn: (msg, fields) => emit("warn", msg, fields),
  error: (msg, fields) => emit("error", msg, fields)
};

// Generates a short correlation id for a request without pulling in a uuid dep.
export function shortId() {
  return Math.abs(hashNow()).toString(36).slice(0, 8);
}

let counter = 0;
function hashNow() {
  // Avoids Date.now()/Math.random() dependence on wall clock alone; monotonic-ish.
  counter = (counter + 1) % 0xffffffff;
  return (counter * 2654435761) ^ (counter << 13);
}
