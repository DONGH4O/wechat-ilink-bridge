import { accountStatePath, ensureStateDir } from "./state-dir.js";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import { withAccountLock } from "./lock.js";

export function contextTokenFilePath(stateDir, accountId) {
  return accountStatePath(stateDir, accountId, ".context-tokens.json");
}

export async function readContextTokens(stateDir, accountId) {
  return readJsonFile(contextTokenFilePath(stateDir, accountId), {});
}

export async function writeContextTokens(stateDir, accountId, tokens) {
  await ensureStateDir(stateDir);
  await writeJsonAtomic(contextTokenFilePath(stateDir, accountId), tokens ?? {});
}

async function rememberContextTokenUnlocked(stateDir, accountId, userId, contextToken) {
  const tokens = await readContextTokens(stateDir, accountId);
  tokens[String(userId)] = String(contextToken);
  await writeContextTokens(stateDir, accountId, tokens);
}

export async function rememberContextToken(stateDir, accountId, userId, contextToken, options = {}) {
  if (!userId || !contextToken) {
    return;
  }

  if (options.lock === false) {
    await rememberContextTokenUnlocked(stateDir, accountId, userId, contextToken);
    return;
  }

  await withAccountLock(stateDir, accountId, () => rememberContextTokenUnlocked(stateDir, accountId, userId, contextToken));
}

export async function resolveContextToken(stateDir, accountId, userId) {
  const tokens = await readContextTokens(stateDir, accountId);
  return tokens[String(userId)];
}
