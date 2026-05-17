import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupState } from "../../src/core/cleanup.js";
import { readAccount, saveAccount } from "../../src/state/account-store.js";
import { readContextTokens, rememberContextToken } from "../../src/state/context-token-store.js";
import { appendMessageHistory, readMessageHistory } from "../../src/state/message-history.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-cleanup-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedAccount(stateDir) {
  await saveAccount(stateDir, {
    accountId: "bot_cleanup",
    token: "bot_secret_cleanup",
    baseUrl: "https://mock.example",
    ownerUserId: "owner_cleanup"
  });
  await rememberContextToken(stateDir, "bot_cleanup", "user_cleanup", "ctx_cleanup");
}

test("cleanup dry-run matches actual cleanup and preserves account credentials and context tokens", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const nowMs = Date.UTC(2026, 4, 17);
    await appendMessageHistory(stateDir, "bot_cleanup", [
      { id: "old", timestamp: Math.floor((nowMs - 10 * 24 * 60 * 60 * 1000) / 1000), text: "old" },
      { id: "new", timestamp: Math.floor(nowMs / 1000), text: "new" }
    ]);
    const inboxDir = path.join(stateDir, "inbox", "bot_cleanup");
    await mkdir(inboxDir, { recursive: true });
    const oldAttachment = path.join(inboxDir, "old.txt");
    const newAttachment = path.join(inboxDir, "new.txt");
    await writeFile(oldAttachment, "old", "utf8");
    await writeFile(newAttachment, "new", "utf8");
    const oldDate = new Date(nowMs - 10 * 24 * 60 * 60 * 1000);
    const newDate = new Date(nowMs);
    await utimes(oldAttachment, oldDate, oldDate);
    await utimes(newAttachment, newDate, newDate);

    const dryRun = await cleanupState({
      stateDir,
      dryRun: true,
      nowMs,
      messageRetentionDays: 7,
      attachmentRetentionDays: 7,
      maxHistoryMessages: 100
    });
    const actual = await cleanupState({
      stateDir,
      dryRun: false,
      nowMs,
      messageRetentionDays: 7,
      attachmentRetentionDays: 7,
      maxHistoryMessages: 100
    });

    assert.equal(dryRun.totals.messagesDeleted, actual.totals.messagesDeleted);
    assert.equal(dryRun.totals.attachmentsDeleted, actual.totals.attachmentsDeleted);
    assert.equal(actual.totals.messagesDeleted, 1);
    assert.equal(actual.totals.attachmentsDeleted, 1);
    assert.deepEqual((await readMessageHistory(stateDir, "bot_cleanup")).map((message) => message.id), ["new"]);
    await assert.rejects(stat(oldAttachment), { code: "ENOENT" });
    assert.equal((await stat(newAttachment)).isFile(), true);
    assert.equal((await readAccount(stateDir, "bot_cleanup")).token, "bot_secret_cleanup");
    assert.deepEqual(await readContextTokens(stateDir, "bot_cleanup"), { user_cleanup: "ctx_cleanup" });
  });
});

test("cleanup maxHistoryMessages keeps the most recent messages", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const nowMs = Date.UTC(2026, 4, 17);
    await appendMessageHistory(stateDir, "bot_cleanup", [
      { id: "m1", timestamp: Math.floor((nowMs - 3 * 1000) / 1000) },
      { id: "m2", timestamp: Math.floor((nowMs - 2 * 1000) / 1000) },
      { id: "m3", timestamp: Math.floor((nowMs - 1 * 1000) / 1000) }
    ]);

    const result = await cleanupState({
      stateDir,
      nowMs,
      messageRetentionDays: 10000,
      attachmentRetentionDays: 10000,
      maxHistoryMessages: 2
    });

    assert.equal(result.totals.messagesDeleted, 1);
    assert.deepEqual((await readMessageHistory(stateDir, "bot_cleanup")).map((message) => message.id), ["m2", "m3"]);
  });
});

test("cleanup with account scope prunes only the selected account attachments", async () => {
  await withTempDir(async (stateDir) => {
    const nowMs = Date.UTC(2026, 4, 17);
    const oldDate = new Date(nowMs - 10 * 24 * 60 * 60 * 1000);
    const files = {};

    for (const accountId of ["bot_cleanup_a", "bot_cleanup_b"]) {
      await saveAccount(stateDir, {
        accountId,
        token: `bot_secret_${accountId}`,
        baseUrl: "https://mock.example",
        ownerUserId: `owner_${accountId}`
      });

      const inboxDir = path.join(stateDir, "inbox", accountId);
      await mkdir(inboxDir, { recursive: true });
      files[accountId] = path.join(inboxDir, "old.txt");
      await writeFile(files[accountId], accountId, "utf8");
      await utimes(files[accountId], oldDate, oldDate);
    }

    const result = await cleanupState({
      stateDir,
      accountId: "bot_cleanup_a",
      nowMs,
      messageRetentionDays: 10000,
      attachmentRetentionDays: 7,
      maxHistoryMessages: 100
    });

    assert.deepEqual(result.accounts.map((account) => account.accountId), ["bot_cleanup_a"]);
    assert.equal(result.totals.attachmentsDeleted, 1);
    await assert.rejects(stat(files.bot_cleanup_a), { code: "ENOENT" });
    assert.equal((await stat(files.bot_cleanup_b)).isFile(), true);
  });
});

test("cleanup rejects an unknown scoped account before scanning attachments", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const nowMs = Date.UTC(2026, 4, 17);
    const oldDate = new Date(nowMs - 10 * 24 * 60 * 60 * 1000);
    const inboxDir = path.join(stateDir, "inbox", "bot_cleanup");
    const oldAttachment = path.join(inboxDir, "old.txt");
    await mkdir(inboxDir, { recursive: true });
    await writeFile(oldAttachment, "old", "utf8");
    await utimes(oldAttachment, oldDate, oldDate);

    await assert.rejects(
      cleanupState({
        stateDir,
        accountId: "missing_bot",
        nowMs,
        messageRetentionDays: 10000,
        attachmentRetentionDays: 7,
        maxHistoryMessages: 100
      }),
      (error) => {
        assert.equal(error.code, "ACCOUNT_NOT_FOUND");
        assert.equal(error.details.accountId, "missing_bot");
        return true;
      }
    );
    assert.equal((await stat(oldAttachment)).isFile(), true);
  });
});
