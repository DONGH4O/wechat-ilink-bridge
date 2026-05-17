import { accountStatePath, ensureStateDir } from "./state-dir.js";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import { withAccountLock } from "./lock.js";

export function seenStoreFilePath(stateDir, accountId) {
  return accountStatePath(stateDir, accountId, ".seen-msg-ids.json");
}

export async function readSeenIds(stateDir, accountId) {
  const value = await readJsonFile(seenStoreFilePath(stateDir, accountId), { seenIds: [] });
  return Array.isArray(value.seenIds) ? value.seenIds : [];
}

export async function writeSeenIds(stateDir, accountId, seenIds) {
  await ensureStateDir(stateDir);
  await writeJsonAtomic(seenStoreFilePath(stateDir, accountId), { seenIds: Array.from(seenIds ?? []) });
}

async function markSeenIdsUnlocked(stateDir, accountId, ids, options = {}) {
  const maxIds = options.maxIds ?? 1000;
  const trimTo = options.trimTo ?? 500;
  const seen = await readSeenIds(stateDir, accountId);
  const inputIds = Array.from(ids ?? []).filter(Boolean).map(String);
  const merged = [...seen, ...inputIds];
  const unique = [...new Set(merged)];
  const pruned = unique.length > maxIds ? unique.slice(-trimTo) : unique;
  await writeSeenIds(stateDir, accountId, pruned);
  return pruned;
}

export async function markSeenIds(stateDir, accountId, ids, options = {}) {
  if (options.lock === false) {
    return markSeenIdsUnlocked(stateDir, accountId, ids, options);
  }

  return withAccountLock(stateDir, accountId, () => markSeenIdsUnlocked(stateDir, accountId, ids, options));
}

export async function filterUnseenMessages(stateDir, accountId, messages) {
  const seen = new Set(await readSeenIds(stateDir, accountId));
  return messages.filter((message) => !message.id || !seen.has(message.id));
}
