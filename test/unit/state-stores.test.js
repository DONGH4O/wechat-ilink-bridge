import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getAlias, readAliases, setAlias } from "../../src/state/alias-store.js";
import { hasAccount, listAccounts, readAccount, saveAccount } from "../../src/state/account-store.js";
import { readContextTokens, rememberContextToken, resolveContextToken } from "../../src/state/context-token-store.js";
import { appendMessageHistory, messageHistoryFilePath, readMessageHistory } from "../../src/state/message-history.js";
import { filterUnseenMessages, markSeenIds, readSeenIds } from "../../src/state/seen-store.js";
import { readSyncBuffer, writeSyncBuffer } from "../../src/state/sync-buffer-store.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-stores-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("saves accounts and lists them without exposing tokens", async () => {
  await withTempDir(async (stateDir) => {
    await saveAccount(stateDir, {
      accountId: "bot-1",
      token: "secret-token",
      baseUrl: "https://example.com",
      ownerUserId: "owner-1"
    });

    assert.equal(await hasAccount(stateDir, "bot-1"), true);
    assert.equal((await readAccount(stateDir, "bot-1")).token, "secret-token");

    const accounts = await listAccounts(stateDir);
    assert.deepEqual(accounts, [
      {
        accountId: "bot-1",
        baseUrl: "https://example.com",
        ownerUserId: "owner-1",
        savedAt: accounts[0].savedAt,
        hasToken: true
      }
    ]);
    assert.equal(Object.hasOwn(accounts[0], "token"), false);
  });
});

test("stores context tokens by latest user ID mapping", async () => {
  await withTempDir(async (stateDir) => {
    await rememberContextToken(stateDir, "bot-1", "user-1", "ctx-old");
    await rememberContextToken(stateDir, "bot-1", "user-1", "ctx-new");

    assert.equal(await resolveContextToken(stateDir, "bot-1", "user-1"), "ctx-new");
    assert.deepEqual(await readContextTokens(stateDir, "bot-1"), { "user-1": "ctx-new" });
  });
});

test("serializes concurrent context token and seen ID updates", async () => {
  await withTempDir(async (stateDir) => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => rememberContextToken(stateDir, "bot-1", `user-${index}`, `ctx-${index}`))
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => markSeenIds(stateDir, "bot-1", [`msg-${index}`]))
    );

    assert.equal(Object.keys(await readContextTokens(stateDir, "bot-1")).length, 20);
    assert.equal((await readSeenIds(stateDir, "bot-1")).length, 20);
  });
});

test("stores sync buffers, seen IDs, aliases, and JSONL message history", async () => {
  await withTempDir(async (stateDir) => {
    await writeSyncBuffer(stateDir, "bot-1", "cursor-1");
    assert.equal(await readSyncBuffer(stateDir, "bot-1"), "cursor-1");

    await markSeenIds(stateDir, "bot-1", ["m1", "m2", "m1"], { maxIds: 3, trimTo: 2 });
    assert.deepEqual(await readSeenIds(stateDir, "bot-1"), ["m1", "m2"]);
    assert.deepEqual(
      await filterUnseenMessages(stateDir, "bot-1", [{ id: "m1" }, { id: "m3" }]),
      [{ id: "m3" }]
    );

    await setAlias(stateDir, "user-1", "张三");
    assert.equal(await getAlias(stateDir, "user-1"), "张三");
    assert.deepEqual(await readAliases(stateDir), { "user-1": "张三" });

    await appendMessageHistory(stateDir, "bot-1", [
      { id: "m1", direction: "incoming", text: "你好" },
      { id: "m2", direction: "outgoing", text: "收到" }
    ]);

    assert.deepEqual(await readMessageHistory(stateDir, "bot-1"), [
      { id: "m1", direction: "incoming", text: "你好" },
      { id: "m2", direction: "outgoing", text: "收到" }
    ]);
  });
});

test("reports corrupted JSONL message history clearly", async () => {
  await withTempDir(async (stateDir) => {
    const historyPath = messageHistoryFilePath(stateDir, "bot-1");
    await appendMessageHistory(stateDir, "bot-1", { id: "m0" });
    await writeFile(historyPath, "{\"id\":\"m1\"}\n{broken json}\n", "utf8");

    await assert.rejects(
      readMessageHistory(stateDir, "bot-1"),
      (error) => {
        assert.equal(error.name, "WxbError");
        assert.equal(error.code, "STATE_JSONL_INVALID");
        assert.equal(error.details.lineNumber, 2);
        assert.match(error.details.recoveryHint, /Move the corrupted messages JSONL file aside/);
        return true;
      }
    );
  });
});
