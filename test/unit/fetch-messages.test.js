import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WxbError } from "../../src/core/errors.js";
import { fetchMessages } from "../../src/core/fetch-messages.js";
import { queueTextDelivery } from "../../src/core/delivery-queue.js";
import { saveAccount } from "../../src/state/account-store.js";
import { readContextTokens } from "../../src/state/context-token-store.js";
import { readDeliveryQueue } from "../../src/state/delivery-queue-store.js";
import { messageHistoryFilePath, readMessageHistory } from "../../src/state/message-history.js";
import { readSeenIds } from "../../src/state/seen-store.js";
import { readSyncBuffer, writeSyncBuffer } from "../../src/state/sync-buffer-store.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-fetch-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedAccount(stateDir, account = {}) {
  await saveAccount(stateDir, {
    accountId: account.accountId ?? "bot_001",
    token: account.token ?? "bot_secret",
    baseUrl: "https://mock.example",
    ownerUserId: "owner_001"
  });
}

function fakeUpdatesClient(responses) {
  const queue = [...responses];
  const calls = [];
  const sendCalls = [];

  return {
    calls,
    sendCalls,
    async getUpdates(request) {
      calls.push(request);
      const next = queue.shift() ?? responses.at(-1);
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    async sendTextMessage(request) {
      sendCalls.push(request);
      return { ret: 0 };
    }
  };
}

test("fetchMessages returns empty messages and persists an unchanged cursor on timeout response", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await writeSyncBuffer(stateDir, "bot_001", "cursor_001");
    const client = fakeUpdatesClient([{ ret: 0, msgs: [], get_updates_buf: "cursor_001" }]);

    const result = await fetchMessages({
      stateDir,
      client,
      timeoutMs: 10,
      retry: { maxAttempts: 1 }
    });

    assert.deepEqual(result.messages, []);
    assert.equal(result.cursor.current, "cursor_001");
    assert.equal(result.cursor.advanced, false);
    assert.equal(await readSyncBuffer(stateDir, "bot_001"), "cursor_001");
    assert.equal(client.calls[0].getUpdatesBuf, "cursor_001");
  });
});

test("fetchMessages normalizes, persists, and hides context tokens from public output", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const client = fakeUpdatesClient([
      {
        ret: 0,
        get_updates_buf: "cursor_002",
        msgs: [
          {
            msg_id: "msg_001",
            from_user_id: "user_001",
            to_user_id: "owner_001",
            context_token: "ctx_secret_001",
            timestamp: 1715000000,
            item_list: [
              {
                type: 1,
                text_item: { text: "你好" }
              }
            ]
          }
        ]
      }
    ]);

    const result = await fetchMessages({
      stateDir,
      client,
      retry: { maxAttempts: 1 }
    });

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, "msg_001");
    assert.equal(result.messages[0].text, "你好");
    assert.equal(Object.hasOwn(result.messages[0], "contextToken"), false);
    assert.deepEqual(await readContextTokens(stateDir, "bot_001"), { user_001: "ctx_secret_001" });
    assert.deepEqual(await readSeenIds(stateDir, "bot_001"), ["msg_001"]);

    const history = await readMessageHistory(stateDir, "bot_001");
    assert.equal(history.length, 1);
    assert.equal(history[0].contextToken, "ctx_secret_001");
    assert.equal(await readSyncBuffer(stateDir, "bot_001"), "cursor_002");
  });
});

test("fetchMessages does not output duplicate seen messages", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const response = {
      ret: 0,
      get_updates_buf: "cursor_dup",
      msgs: [
        {
          msg_id: "msg_dup",
          from_user_id: "user_001",
          context_token: "ctx_dup",
          item_list: [{ type: 1, text_item: { text: "repeat" } }]
        }
      ]
    };
    const client = fakeUpdatesClient([response, response]);

    const first = await fetchMessages({ stateDir, client, retry: { maxAttempts: 1 } });
    const second = await fetchMessages({ stateDir, client, retry: { maxAttempts: 1 } });

    assert.equal(first.newMessageCount, 1);
    assert.equal(second.rawMessageCount, 1);
    assert.equal(second.newMessageCount, 0);
    assert.deepEqual(second.messages, []);
    assert.equal((await readMessageHistory(stateDir, "bot_001")).length, 1);
  });
});

test("fetchMessages flushes only one delayed delivery per user for each fetch batch", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await queueTextDelivery({
      stateDir,
      accountId: "bot_001",
      userId: "user_001",
      text: "first queued"
    });
    await queueTextDelivery({
      stateDir,
      accountId: "bot_001",
      userId: "user_001",
      text: "second queued"
    });
    const client = fakeUpdatesClient([
      {
        ret: 0,
        get_updates_buf: "cursor_delayed",
        msgs: [
          {
            msg_id: "msg_delayed_1",
            from_user_id: "user_001",
            to_user_id: "owner_001",
            context_token: "ctx_fresh_1",
            timestamp: 1715000000,
            item_list: [{ type: 1, text_item: { text: "fresh context" } }]
          },
          {
            msg_id: "msg_delayed_2",
            from_user_id: "user_001",
            to_user_id: "owner_001",
            context_token: "ctx_fresh_2",
            timestamp: 1715000001,
            item_list: [{ type: 1, text_item: { text: "fresh context again" } }]
          }
        ]
      }
    ]);

    const result = await fetchMessages({
      stateDir,
      client,
      retry: { maxAttempts: 1 }
    });

    assert.equal(result.newMessageCount, 2);
    assert.equal(result.delayedDeliveries.length, 1);
    assert.equal(result.delayedDeliveries[0].status, "sent");
    assert.equal(client.sendCalls.length, 1);
    assert.equal(client.sendCalls[0].text, "first queued");
    assert.equal(client.sendCalls[0].contextToken, "ctx_fresh_2");
    const history = await readMessageHistory(stateDir, "bot_001");
    assert.equal(history.length, 3);
    assert.equal(history[2].text, "first queued");
    assert.equal(history[2].delayedDeliveryId, result.delayedDeliveries[0].queueId);
    const queue = await readDeliveryQueue(stateDir, "bot_001");
    assert.equal(queue.length, 1);
    assert.equal(queue[0].text, "second queued");
  });
});

test("fetchMessages keeps text output when media download fails", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const client = fakeUpdatesClient([
      {
        ret: 0,
        get_updates_buf: "cursor_media_fail",
        msgs: [
          {
            msg_id: "msg_media_fail",
            from_user_id: "user_001",
            context_token: "ctx_media_fail",
            item_list: [
              { type: 1, text_item: { text: "caption survives" } },
              {
                type: 3,
                image_item: {
                  file_id: "image_fail",
                  file_name: "image.jpg",
                  cdn_url: "https://cdn.example/missing"
                }
              }
            ]
          }
        ]
      }
    ]);

    const result = await fetchMessages({
      stateDir,
      client,
      downloadMedia: true,
      mediaFetchImpl: async () => {
        throw new Error("cdn unavailable");
      },
      retry: { maxAttempts: 1 }
    });

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].text, "caption survives");
    assert.equal(result.messages[0].type, "mixed");
    assert.equal(result.messages[0].mediaDownload.failed, 1);
    assert.equal(result.messages[0].items[1].download.ok, false);
    assert.equal(result.messages[0].items[1].download.error.code, "MEDIA_DOWNLOAD_FAILED");
    assert.equal(result.newMessageCount, 1);
  });
});

test("fetchMessages keeps text output when media URL parsing fails", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const client = fakeUpdatesClient([
      {
        ret: 0,
        get_updates_buf: "cursor_media_bad_url",
        msgs: [
          {
            msg_id: "msg_media_bad_url",
            from_user_id: "user_001",
            context_token: "ctx_media_bad_url",
            item_list: [
              { type: 1, text_item: { text: "caption survives bad url" } },
              {
                type: 3,
                image_item: {
                  file_name: "image.jpg",
                  cdn_url: "http://[bad-url?token=secret",
                  aeskey: "00112233445566778899aabbccddeeff"
                }
              }
            ]
          }
        ]
      }
    ]);

    const result = await fetchMessages({
      stateDir,
      client,
      downloadMedia: true,
      retry: { maxAttempts: 1 }
    });

    const message = result.messages[0];
    const mediaItem = message.items[1];
    const serialized = JSON.stringify(result);
    assert.equal(message.text, "caption survives bad url");
    assert.equal(message.mediaDownload.failed, 1);
    assert.equal(mediaItem.download.ok, false);
    assert.equal(mediaItem.download.error.code, "MEDIA_DOWNLOAD_FAILED");
    assert.equal(serialized.includes("http://[bad-url"), false);
    assert.equal(serialized.includes("00112233445566778899aabbccddeeff"), false);
    assert.equal(await readSyncBuffer(stateDir, "bot_001"), "cursor_media_bad_url");
  });
});

test("fetchMessages skips media downloads for already seen messages", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    let mediaFetchCount = 0;
    const response = {
      ret: 0,
      get_updates_buf: "cursor_media_seen",
      msgs: [
        {
          msg_id: "msg_media_seen",
          from_user_id: "user_001",
          context_token: "ctx_media_seen",
          item_list: [
            {
              type: 3,
              image_item: {
                file_name: "seen.jpg",
                mime_type: "image/jpeg",
                cdn_url: "https://cdn.example/seen.jpg"
              }
            }
          ]
        }
      ]
    };
    const client = fakeUpdatesClient([response, response]);
    const mediaFetchImpl = async () => {
      mediaFetchCount += 1;
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Uint8Array.from([0xff, 0xd8, 0xff]).buffer;
        }
      };
    };

    const first = await fetchMessages({
      stateDir,
      client,
      downloadMedia: true,
      mediaFetchImpl,
      retry: { maxAttempts: 1 }
    });
    const second = await fetchMessages({
      stateDir,
      client,
      downloadMedia: true,
      mediaFetchImpl,
      retry: { maxAttempts: 1 }
    });

    assert.equal(first.newMessageCount, 1);
    assert.equal(first.messages[0].mediaDownload.succeeded, 1);
    assert.equal(second.newMessageCount, 0);
    assert.deepEqual(second.messages, []);
    assert.equal(mediaFetchCount, 1);
  });
});

test("fetchMessages synthesizes stable IDs for messages missing protocol IDs", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const response = {
      ret: 0,
      get_updates_buf: "cursor_no_id",
      msgs: [
        {
          from_user_id: "user_001",
          context_token: "ctx_no_id",
          item_list: [{ type: 1, text_item: { text: "no id" } }]
        }
      ]
    };
    const client = fakeUpdatesClient([response, response]);

    const first = await fetchMessages({ stateDir, client, retry: { maxAttempts: 1 } });
    const second = await fetchMessages({ stateDir, client, retry: { maxAttempts: 1 } });
    const [historyMessage] = await readMessageHistory(stateDir, "bot_001");
    const [seenId] = await readSeenIds(stateDir, "bot_001");

    assert.equal(first.newMessageCount, 1);
    assert.equal(first.messages[0].id.startsWith("synthetic-"), true);
    assert.equal(second.newMessageCount, 0);
    assert.deepEqual(second.messages, []);
    assert.equal(historyMessage.id, first.messages[0].id);
    assert.equal(seenId, first.messages[0].id);
  });
});

test("fetchMessages does not advance cursor when message history write fails", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await writeSyncBuffer(stateDir, "bot_001", "old_cursor");
    await mkdir(messageHistoryFilePath(stateDir, "bot_001"), { recursive: true });
    const client = fakeUpdatesClient([
      {
        ret: 0,
        get_updates_buf: "new_cursor",
        msgs: [
          {
            msg_id: "msg_001",
            from_user_id: "user_001",
            context_token: "ctx_001",
            item_list: [{ type: 1, text_item: { text: "will fail" } }]
          }
        ]
      }
    ]);

    await assert.rejects(
      fetchMessages({ stateDir, client, retry: { maxAttempts: 1 } }),
      (error) => {
        assert.equal(error.code, "EISDIR");
        return true;
      }
    );

    assert.equal(await readSyncBuffer(stateDir, "bot_001"), "old_cursor");
  });
});

test("fetchMessages rejects invalid retry attempt counts", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);

    await assert.rejects(
      fetchMessages({
        stateDir,
        client: fakeUpdatesClient([{ ret: 0, msgs: [], get_updates_buf: "" }]),
        retry: { maxAttempts: 0 }
      }),
      (error) => {
        assert.equal(error.name, "WxbError");
        assert.equal(error.code, "CONFIG_VALUE_INVALID");
        assert.equal(error.details.key, "maxAttempts");
        return true;
      }
    );
  });
});

test("fetchMessages retries retryable failures without advancing cursor until success", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await writeSyncBuffer(stateDir, "bot_001", "old_cursor");
    const serverError = new WxbError("SERVER_ERROR", "temporary server error", { retryable: true, status: 502 });
    const client = fakeUpdatesClient([
      serverError,
      { ret: 0, msgs: [], get_updates_buf: "new_cursor" }
    ]);

    const result = await fetchMessages({
      stateDir,
      client,
      retry: { maxAttempts: 2, retryDelaysMs: [0] }
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.cursor.current, "new_cursor");
    assert.equal(await readSyncBuffer(stateDir, "bot_001"), "new_cursor");
  });
});

test("fetchMessages surfaces session expiry and preserves the previous cursor", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    await writeSyncBuffer(stateDir, "bot_001", "old_cursor");
    const client = fakeUpdatesClient([
      new WxbError("SESSION_EXPIRED", "expired", { retryable: false })
    ]);

    await assert.rejects(
      fetchMessages({ stateDir, client, retry: { maxAttempts: 1 } }),
      (error) => {
        assert.equal(error.code, "SESSION_EXPIRED");
        return true;
      }
    );

    assert.equal(await readSyncBuffer(stateDir, "bot_001"), "old_cursor");
    assert.deepEqual(await readSeenIds(stateDir, "bot_001"), []);
  });
});
