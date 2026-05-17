import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getAccountStatuses,
  listPublicAccounts,
  loginWithQrcode
} from "../../src/core/auth.js";
import { readAccount } from "../../src/state/account-store.js";
import { rememberContextToken } from "../../src/state/context-token-store.js";
import { appendMessageHistory } from "../../src/state/message-history.js";
import { writeSyncBuffer } from "../../src/state/sync-buffer-store.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-auth-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function fakeLoginClient(statuses) {
  const statusQueue = [...statuses];
  return {
    async getBotQrcode() {
      return {
        qrcode: "qr_fixture",
        qrcode_img_url: "https://example.test/qr"
      };
    },
    async getQrcodeStatus() {
      return statusQueue.shift() ?? statuses.at(-1);
    }
  };
}

test("loginWithQrcode saves confirmed credentials and returns a public account view", async () => {
  await withTempDir(async (stateDir) => {
    const result = await loginWithQrcode({
      stateDir,
      config: { baseUrl: "https://ilinkai.weixin.qq.com", loginPollTimeoutMs: 1 },
      client: fakeLoginClient([
        { status: "wait" },
        { status: "scaned" },
        {
          status: "confirmed",
          bot_token: "bot_secret",
          ilink_bot_id: "bot_001",
          ilink_user_id: "owner_001",
          baseurl: "https://ilinkai.weixin.qq.com"
        }
      ]),
      maxPolls: 3,
      pollIntervalMs: 0
    });

    assert.equal(result.account.accountId, "bot_001");
    assert.equal(result.account.hasToken, true);
    assert.equal(Object.hasOwn(result.account, "token"), false);

    const stored = await readAccount(stateDir, "bot_001");
    assert.equal(stored.token, "bot_secret");

    const accounts = await listPublicAccounts(stateDir);
    assert.equal(accounts.length, 1);
    assert.equal(Object.hasOwn(accounts[0], "token"), false);
  });
});

test("loginWithQrcode handles expired QR codes without writing an account", async () => {
  await withTempDir(async (stateDir) => {
    await assert.rejects(
      loginWithQrcode({
        stateDir,
        config: {},
        client: fakeLoginClient([{ status: "expired" }]),
        maxPolls: 1,
        pollIntervalMs: 0
      }),
      (error) => {
        assert.equal(error.code, "LOGIN_QRCODE_EXPIRED");
        return true;
      }
    );

    assert.deepEqual(await listPublicAccounts(stateDir), []);
  });
});

test("getAccountStatuses reports local cursor, conversation, and history counts", async () => {
  await withTempDir(async (stateDir) => {
    await loginWithQrcode({
      stateDir,
      config: { baseUrl: "https://ilinkai.weixin.qq.com" },
      client: fakeLoginClient([
        {
          status: "confirmed",
          bot_token: "bot_secret",
          ilink_bot_id: "bot_001",
          ilink_user_id: "owner_001"
        }
      ]),
      maxPolls: 1,
      pollIntervalMs: 0
    });
    await writeSyncBuffer(stateDir, "bot_001", "cursor_fixture");
    await rememberContextToken(stateDir, "bot_001", "user_1", "ctx_1");
    await rememberContextToken(stateDir, "bot_001", "user_2", "ctx_2");
    await appendMessageHistory(stateDir, "bot_001", [{ id: "m1" }, { id: "m2" }]);

    const [status] = await getAccountStatuses(stateDir);

    assert.equal(status.accountId, "bot_001");
    assert.equal(status.connection, "configured");
    assert.equal(status.sync.hasBuffer, true);
    assert.equal(status.sync.bufferLength, "cursor_fixture".length);
    assert.equal(status.conversations.count, 2);
    assert.equal(status.messages.count, 2);
    assert.equal(Object.hasOwn(status, "token"), false);
  });
});
