import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WxbError } from "../../src/core/errors.js";
import { sendText } from "../../src/core/send-text.js";
import { saveAccount } from "../../src/state/account-store.js";
import { setAlias } from "../../src/state/alias-store.js";
import { rememberContextToken } from "../../src/state/context-token-store.js";
import { readDeliveryQueue } from "../../src/state/delivery-queue-store.js";
import { messageHistoryFilePath, readMessageHistory } from "../../src/state/message-history.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-send-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedAccount(stateDir) {
  await saveAccount(stateDir, {
    accountId: "bot_001",
    token: "bot_secret",
    baseUrl: "https://mock.example",
    ownerUserId: "owner_001"
  });
}

function fakeSendClient(options = {}) {
  const calls = [];
  return {
    calls,
    async sendTextMessage(request) {
      calls.push(request);
      const failure = options.failAt === calls.length ? options.error : undefined;
      if (failure) {
        throw failure;
      }
      return { ret: 0 };
    }
  };
}

test("sendText sends text with cached context token and writes outgoing history", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await rememberContextToken(stateDir, "bot_001", "user_001", "ctx_secret");
    const client = fakeSendClient();

    const result = await sendText({
      stateDir,
      userId: "user_001",
      text: "hello",
      client,
      config: {
        maxChunkChars: 100,
        minChunkChars: 20,
        maxDeliveryMessages: 10
      }
    });

    assert.equal(result.chunkCount, 1);
    assert.equal(result.sent.length, 1);
    assert.match(result.sent[0].clientId, /^wxb-\d+-[a-f0-9]{8}$/);
    assert.equal(Object.values(result).includes("ctx_secret"), false);
    assert.equal(client.calls[0].token, "bot_secret");
    assert.equal(client.calls[0].toUserId, "user_001");
    assert.equal(client.calls[0].contextToken, "ctx_secret");

    const history = await readMessageHistory(stateDir, "bot_001");
    assert.equal(history.length, 1);
    assert.equal(history[0].direction, "outgoing");
    assert.equal(history[0].text, "hello");
    assert.equal(history[0].contextToken, "ctx_secret");
  });
});

test("sendText sends long text as multiple chunks with unique client IDs", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await rememberContextToken(stateDir, "bot_001", "user_001", "ctx_secret");
    const client = fakeSendClient();
    const text = "Hello world. Next.";

    const result = await sendText({
      stateDir,
      userId: "user_001",
      text,
      client,
      config: {
        maxChunkChars: 13,
        minChunkChars: 5,
        maxDeliveryMessages: 10
      }
    });

    assert.equal(result.chunkCount, 2);
    assert.equal(client.calls.length, 2);
    assert.notEqual(result.sent[0].clientId, result.sent[1].clientId);
    assert.equal(client.calls.map((call) => call.text).join(""), text);
    assert.equal((await readMessageHistory(stateDir, "bot_001")).length, 2);
  });
});

test("sendText fails with NO_CONTEXT_TOKEN when no token is cached", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const client = fakeSendClient();

    await assert.rejects(
      sendText({
        stateDir,
        userId: "user_001",
        text: "hello",
        client
      }),
      (error) => {
        assert.equal(error.code, "NO_CONTEXT_TOKEN");
        assert.equal(error.details.userId, "user_001");
        return true;
      }
    );
    assert.equal(client.calls.length, 0);
  });
});

test("sendText can queue when no context is cached and explicit queueing is requested", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const client = fakeSendClient();

    const result = await sendText({
      stateDir,
      userId: "user_001",
      text: "queue me",
      client,
      queueOnNoContext: true
    });

    assert.equal(result.queued, true);
    assert.equal(result.delivered, false);
    assert.equal(result.queue.userId, "user_001");
    assert.equal(result.queue.chars, "queue me".length);
    assert.equal(client.calls.length, 0);
    assert.equal((await readDeliveryQueue(stateDir, "bot_001")).length, 1);
  });
});

test("sendText queues the original text when iLink rejects an expired context token before delivery", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await rememberContextToken(stateDir, "bot_001", "user_001", "ctx_stale");
    const client = fakeSendClient({
      failAt: 1,
      error: new WxbError("INVALID_CONTEXT_TOKEN", "invalid context", { retryable: false })
    });

    const result = await sendText({
      stateDir,
      userId: "user_001",
      text: "retry later",
      client
    });

    assert.equal(result.queued, true);
    assert.equal(result.delivered, false);
    assert.equal(result.queue.source, "invalid_context");
    const queue = await readDeliveryQueue(stateDir, "bot_001");
    assert.equal(queue.length, 1);
    assert.equal(queue[0].text, "retry later");
    assert.equal(queue[0].lastError.code, "INVALID_CONTEXT_TOKEN");
    assert.equal((await readMessageHistory(stateDir, "bot_001")).length, 0);
  });
});

test("sendText can resolve an alias without affecting direct user ID sending", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await setAlias(stateDir, "user_001", "张三");
    await rememberContextToken(stateDir, "bot_001", "user_001", "ctx_secret");
    const aliasClient = fakeSendClient();
    const directClient = fakeSendClient();

    await sendText({
      stateDir,
      alias: "张三",
      text: "alias hello",
      client: aliasClient
    });
    await sendText({
      stateDir,
      userId: "user_001",
      text: "direct hello",
      client: directClient
    });

    assert.equal(aliasClient.calls[0].toUserId, "user_001");
    assert.equal(directClient.calls[0].toUserId, "user_001");
  });
});

test("sendText reports partial delivery metadata when a later chunk fails", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await rememberContextToken(stateDir, "bot_001", "user_001", "ctx_secret");
    const client = fakeSendClient({
      failAt: 2,
      error: new WxbError("SESSION_EXPIRED", "expired", { retryable: false })
    });

    await assert.rejects(
      sendText({
        stateDir,
        userId: "user_001",
        text: "Hello world. Next.",
        client,
        config: {
          maxChunkChars: 13,
          minChunkChars: 5,
          maxDeliveryMessages: 10
        }
      }),
      (error) => {
        assert.equal(error.code, "SESSION_EXPIRED");
        assert.equal(error.details.sentCount, 1);
        assert.equal(error.details.failedChunkIndex, 2);
        assert.equal(error.details.totalChunks, 2);
        return true;
      }
    );

    const history = await readMessageHistory(stateDir, "bot_001");
    assert.equal(history.length, 1);
  });
});

test("sendText reports delivered chunk when outgoing history write fails", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await rememberContextToken(stateDir, "bot_001", "user_001", "ctx_secret");
    await mkdir(messageHistoryFilePath(stateDir, "bot_001"), { recursive: true });
    const client = fakeSendClient();

    await assert.rejects(
      sendText({
        stateDir,
        userId: "user_001",
        text: "hello",
        client
      }),
      (error) => {
        assert.equal(error.code, "OUTGOING_HISTORY_WRITE_FAILED");
        assert.equal(error.retryable, false);
        assert.equal(error.details.delivered, true);
        assert.equal(error.details.sentCount, 1);
        assert.equal(error.details.failedChunkIndex, 1);
        assert.equal(error.details.totalChunks, 1);
        assert.match(error.details.clientId, /^wxb-\d+-[a-f0-9]{8}$/);
        assert.deepEqual(error.details.deliveredClientIds, [error.details.clientId]);
        return true;
      }
    );

    assert.equal(client.calls.length, 1);
  });
});
