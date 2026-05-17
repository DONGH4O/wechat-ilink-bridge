import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { WxbError } from "./errors.js";
import { listAccounts } from "../state/account-store.js";
import { readMessageHistory, replaceMessageHistory } from "../state/message-history.js";
import { safeAccountId } from "../state/state-dir.js";

function toTimestampMs(value) {
  if (!Number.isFinite(Number(value))) {
    return undefined;
  }

  const numberValue = Number(value);
  return numberValue > 100000000000 ? numberValue : numberValue * 1000;
}

function isExpiredMessage(message, cutoffMs) {
  if (!cutoffMs) {
    return false;
  }

  const timestampMs = toTimestampMs(message.timestamp);
  return timestampMs !== undefined && timestampMs < cutoffMs;
}

function pruneHistory(messages, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const retentionDays = options.messageRetentionDays;
  const maxHistoryMessages = options.maxHistoryMessages;
  const cutoffMs = Number.isFinite(retentionDays) && retentionDays >= 0
    ? nowMs - retentionDays * 24 * 60 * 60 * 1000
    : undefined;
  const afterRetention = messages.filter((message) => !isExpiredMessage(message, cutoffMs));
  const afterMax = Number.isFinite(maxHistoryMessages) && maxHistoryMessages >= 0 && afterRetention.length > maxHistoryMessages
    ? afterRetention.slice(-maxHistoryMessages)
    : afterRetention;

  return {
    kept: afterMax,
    removedCount: messages.length - afterMax.length
  };
}

async function listFilesRecursive(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function cleanupAttachments(stateDir, options = {}) {
  const retentionDays = options.attachmentRetentionDays;
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    return {
      scanned: 0,
      deleted: 0,
      bytesFreed: 0
    };
  }

  const inboxDir = path.join(stateDir, "inbox");
  const cutoffMs = (options.nowMs ?? Date.now()) - retentionDays * 24 * 60 * 60 * 1000;
  const accountIds = options.accountIds;
  const roots = Array.isArray(accountIds) && accountIds.length > 0
    ? accountIds.map((id) => path.join(inboxDir, safeAccountId(id)))
    : [inboxDir];
  const files = [];
  for (const root of roots) {
    files.push(...await listFilesRecursive(root));
  }
  let deleted = 0;
  let bytesFreed = 0;

  for (const filePath of files) {
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs >= cutoffMs) {
      continue;
    }

    deleted += 1;
    bytesFreed += fileStat.size;
    if (!options.dryRun) {
      await rm(filePath, { force: true });
    }
  }

  return {
    scanned: files.length,
    deleted,
    bytesFreed
  };
}

export async function cleanupState(options = {}) {
  const {
    stateDir,
    accountId,
    dryRun = false,
    nowMs = Date.now(),
    messageRetentionDays,
    attachmentRetentionDays,
    maxHistoryMessages
  } = options;

  if (!stateDir) {
    throw new TypeError("stateDir is required");
  }

  const accounts = await listAccounts(stateDir, { includeSecrets: false });
  const selectedAccounts = accountId
    ? accounts.filter((account) => account.accountId === accountId)
    : accounts;
  const accountResults = [];

  if (accountId && selectedAccounts.length === 0) {
    throw new WxbError("ACCOUNT_NOT_FOUND", `Account not found: ${accountId}`, {
      retryable: false,
      details: { accountId }
    });
  }

  for (const account of selectedAccounts) {
    const history = await readMessageHistory(stateDir, account.accountId);
    const pruned = pruneHistory(history, {
      nowMs,
      messageRetentionDays,
      maxHistoryMessages
    });

    if (!dryRun && pruned.removedCount > 0) {
      await replaceMessageHistory(stateDir, account.accountId, pruned.kept);
    }

    accountResults.push({
      accountId: account.accountId,
      messagesScanned: history.length,
      messagesDeleted: pruned.removedCount,
      messagesKept: pruned.kept.length
    });
  }

  const attachments = await cleanupAttachments(stateDir, {
    nowMs,
    dryRun,
    attachmentRetentionDays,
    accountIds: accountId ? selectedAccounts.map((account) => account.accountId) : undefined
  });

  return {
    dryRun,
    accounts: accountResults,
    totals: {
      messagesScanned: accountResults.reduce((sum, item) => sum + item.messagesScanned, 0),
      messagesDeleted: accountResults.reduce((sum, item) => sum + item.messagesDeleted, 0),
      messagesKept: accountResults.reduce((sum, item) => sum + item.messagesKept, 0),
      attachmentsScanned: attachments.scanned,
      attachmentsDeleted: attachments.deleted,
      attachmentBytesFreed: attachments.bytesFreed
    }
  };
}
