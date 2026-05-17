import { accountStatePath, ensureStateDir } from "./state-dir.js";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";

export function syncBufferFilePath(stateDir, accountId) {
  return accountStatePath(stateDir, accountId, ".sync-buffer.json");
}

export async function readSyncBuffer(stateDir, accountId) {
  const value = await readJsonFile(syncBufferFilePath(stateDir, accountId), { buffer: "" });
  return value.buffer ?? "";
}

export async function writeSyncBuffer(stateDir, accountId, buffer) {
  await ensureStateDir(stateDir);
  await writeJsonAtomic(syncBufferFilePath(stateDir, accountId), { buffer: buffer ?? "" });
}
