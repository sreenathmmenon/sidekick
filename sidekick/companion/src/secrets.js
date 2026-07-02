import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// OS keychain-backed secret storage with a graceful 0600-file fallback.
//
// Production hardening item: the API token should not live in plaintext on disk
// when the platform offers a real secret store. We shell out to the OS-native
// tools (no native deps, keeping the zero-dependency constraint):
//   - macOS:  `security` (login keychain)
//   - Linux:  `secret-tool` (libsecret / GNOME Keyring), if installed
//   - else:   a 0600 file under the data dir
//
// The chosen backend is reported so the UI/logs can show where the token lives.

const SERVICE = "sidekick-local-companion";
const ACCOUNT = "api-token";

// Generic named-secret storage (e.g. the GitHub PAT) using the same OS-native
// backends. Stored under a distinct account so it never collides with the API token.
export function storeSecret(name, value) {
  const backend = detectBackend();
  if (backend === "macos") {
    const set = spawnSync("security", ["add-generic-password", "-s", SERVICE, "-a", name, "-w", value, "-U"], { stdio: "ignore" });
    return set.status === 0;
  }
  if (backend === "linux") {
    const set = spawnSync("secret-tool", ["store", "--label=Sidekick " + name, "service", SERVICE, "account", name], { input: value, encoding: "utf8" });
    return set.status === 0;
  }
  // File fallback: a 0600 file under the data dir, so users without a keychain can
  // still use connectors (less ideal than the keychain, but never plaintext in the DB).
  return writeSecretFile(name, value);
}

export function readSecret(name) {
  const backend = detectBackend();
  if (backend === "macos") {
    const found = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", name, "-w"], { encoding: "utf8" });
    if (found.status === 0) return found.stdout.trim();
  }
  if (backend === "linux") {
    const found = spawnSync("secret-tool", ["lookup", "service", SERVICE, "account", name], { encoding: "utf8" });
    if (found.status === 0) return found.stdout.trim();
  }
  return readSecretFile(name);
}

function secretFilePath(name) {
  const dir = process.env.SIDEKICK_DATA_DIR || join(homedir(), ".sidekick");
  return join(dir, `secret-${name}`);
}
function writeSecretFile(name, value) {
  try {
    const path = secretFilePath(name);
    writeFileSync(path, value, { mode: 0o600 });
    chmodSync(path, 0o600);
    return true;
  } catch {
    return false;
  }
}
function readSecretFile(name) {
  try {
    return readFileSync(secretFilePath(name), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function loadOrCreateToken(dataDir, generate, deps) {
  const backend = detectBackend();
  if (backend === "macos") return macosToken(generate, deps);
  if (backend === "linux") return linuxToken(generate, deps);
  return fileToken(dataDir, generate, deps);
}

export function describeSecretBackend() {
  return detectBackend();
}

function detectBackend() {
  if (process.env.SIDEKICK_KEYCHAIN === "file") return "file";
  if (process.platform === "darwin" && hasBinary("security")) return "macos";
  if (process.platform === "linux" && hasBinary("secret-tool")) return "linux";
  return "file";
}

function hasBinary(name) {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore" });
  return probe.status === 0;
}

// ---- macOS keychain ----
function macosToken(generate, deps) {
  const found = spawnSync("security", [
    "find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"
  ], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) {
    deps.logger?.info("api token loaded from macOS keychain");
    return found.stdout.trim();
  }
  const token = generate();
  const set = spawnSync("security", [
    "add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", token, "-U"
  ], { stdio: "ignore" });
  if (set.status !== 0) {
    deps.logger?.warn("could not write to macOS keychain; falling back to file token");
    return fileTokenFromGenerated(generate, deps, token);
  }
  deps.logger?.info("api token stored in macOS keychain");
  return token;
}

// ---- Linux libsecret ----
function linuxToken(generate, deps) {
  const found = spawnSync("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT], { encoding: "utf8" });
  if (found.status === 0 && found.stdout.trim()) {
    deps.logger?.info("api token loaded from libsecret keyring");
    return found.stdout.trim();
  }
  const token = generate();
  const set = spawnSync("secret-tool",
    ["store", "--label=Sidekick API token", "service", SERVICE, "account", ACCOUNT],
    { input: token, encoding: "utf8" });
  if (set.status !== 0) {
    deps.logger?.warn("could not write to libsecret keyring; falling back to file token");
    return fileTokenFromGenerated(generate, deps, token);
  }
  deps.logger?.info("api token stored in libsecret keyring");
  return token;
}

// ---- 0600 file fallback ----
function fileToken(dataDir, generate, deps) {
  const tokenPath = join(dataDir, "api-token");
  try {
    return deps.readFileSync(tokenPath, "utf8").trim();
  } catch {
    const token = generate();
    deps.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
    deps.logger?.info("api token stored in 0600 file (no OS keychain available)");
    return token;
  }
}

function fileTokenFromGenerated(generate, deps, token) {
  // used only when keychain write fails after we already generated a token
  return token;
}
