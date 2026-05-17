import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(inputPath, homeDir = os.homedir()) {
  if (inputPath === "~") {
    return homeDir;
  }

  if (inputPath?.startsWith("~/") || inputPath?.startsWith("~\\")) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

export function defaultStateDir({ env = process.env, platform = process.platform, homeDir = os.homedir() } = {}) {
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "wxb");
  }

  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "wxb");
  }

  return path.join(env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"), "wxb");
}

export function resolveStateDir(options = {}) {
  const {
    stateDir,
    env = process.env,
    platform = process.platform,
    homeDir = os.homedir(),
    cwd = process.cwd()
  } = options;

  const override = stateDir ?? env.WX_STATE_DIR;
  const selected = override && String(override).trim()
    ? expandHome(String(override).trim(), homeDir)
    : defaultStateDir({ env, platform, homeDir });

  return path.resolve(cwd, selected);
}

export function accountsDir(stateDir) {
  return path.join(stateDir, "accounts");
}

export async function ensureStateDir(stateDir) {
  await mkdir(accountsDir(stateDir), { recursive: true });
  return stateDir;
}

export function safeAccountId(accountId) {
  if (!accountId || typeof accountId !== "string") {
    throw new TypeError("accountId must be a non-empty string");
  }

  return accountId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function accountStatePath(stateDir, accountId, suffix = ".json") {
  return path.join(accountsDir(stateDir), `${safeAccountId(accountId)}${suffix}`);
}
