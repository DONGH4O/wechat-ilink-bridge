import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { accountStatePath, accountsDir, ensureStateDir } from "./state-dir.js";
import { pathExists, readJsonFile, writeJsonAtomic } from "./json-file.js";

function normalizeAccount(account) {
  if (!account?.accountId) {
    throw new TypeError("account.accountId is required");
  }

  return {
    accountId: String(account.accountId),
    token: account.token ?? "",
    baseUrl: account.baseUrl,
    ownerUserId: account.ownerUserId,
    savedAt: account.savedAt ?? new Date().toISOString()
  };
}

export function accountFilePath(stateDir, accountId) {
  return accountStatePath(stateDir, accountId, ".json");
}

export function publicAccountView(account) {
  return {
    accountId: account.accountId,
    baseUrl: account.baseUrl,
    ownerUserId: account.ownerUserId,
    savedAt: account.savedAt,
    hasToken: Boolean(account.token)
  };
}

export async function saveAccount(stateDir, account) {
  await ensureStateDir(stateDir);
  const normalized = normalizeAccount(account);
  await writeJsonAtomic(accountFilePath(stateDir, normalized.accountId), normalized);
  return normalized;
}

export async function readAccount(stateDir, accountId) {
  return readJsonFile(accountFilePath(stateDir, accountId));
}

export async function hasAccount(stateDir, accountId) {
  return pathExists(accountFilePath(stateDir, accountId));
}

export async function listAccounts(stateDir, options = {}) {
  await ensureStateDir(stateDir);
  const names = await readdir(accountsDir(stateDir));
  const accountFiles = names.filter((name) => name.endsWith(".json")
    && !name.includes(".context-tokens")
    && !name.includes(".sync-buffer")
    && !name.includes(".seen-msg-ids")
    && !name.includes(".delivery-queue"));
  const accounts = [];

  for (const name of accountFiles) {
    const account = await readJsonFile(path.join(accountsDir(stateDir), name));
    accounts.push(options.includeSecrets ? account : publicAccountView(account));
  }

  return accounts.sort((a, b) => a.accountId.localeCompare(b.accountId));
}

export async function removeAccount(stateDir, accountId) {
  await rm(accountFilePath(stateDir, accountId), { force: true });
}
