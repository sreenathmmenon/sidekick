const SECRET_PATTERNS = [
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi
];

export function redactText(value) {
  if (typeof value !== "string") {
    return value;
  }

  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "[REDACTED]"),
    value
  );
}

// Stronger redaction applied ONLY to text that is about to leave the machine for a
// cloud LLM. On top of the secret/email scrubbing, it masks capitalized personal
// names (a coarse PII guard for 1:1/perf phrasing) while preserving sentence-start
// words and a small allow-list, so the model still gets enough structure to extract
// obligations. This is what lets the cloud tier be defensible to Legal.
const NAME_ALLOWLIST = new Set([
  "I", "We", "You", "They", "The", "A", "An", "Action", "Decision", "Monday", "Tuesday",
  "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Today", "Tomorrow", "PR", "FYI"
]);

export function redactForCloud(value) {
  if (typeof value !== "string") return value;
  let text = redactText(value); // secrets + emails first
  // Mask standalone Capitalized words that look like names, except sentence-start
  // and allow-listed tokens. Replace with a stable [NAME] placeholder.
  text = text.replace(/(^|[.!?]\s+)?(\b[A-Z][a-z]{1,20}\b)/g, (match, lead, word) => {
    if (lead) return match; // sentence-initial: keep
    if (NAME_ALLOWLIST.has(word)) return match;
    return match.replace(word, "[NAME]");
  });
  return text;
}

export function redactRef(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(ref).map(([key, value]) => [
      key,
      typeof value === "string" ? redactText(value) : value
    ])
  );
}
