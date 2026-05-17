import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sendMedia } from "../../src/core/send-media.js";
import { WxbError } from "../../src/core/errors.js";
import { saveAccount } from "../../src/state/account-store.js";
import { rememberContextToken, resolveContextToken } from "../../src/state/context-token-store.js";
import { readMessageHistory } from "../../src/state/message-history.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-send-media-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedAccount(stateDir) {
  await saveAccount(stateDir, {
    accountId: "bot_media",
    token: "bot_secret_media",
    baseUrl: "https://mock.example",
    ownerUserId: "owner_media"
  });
  await rememberContextToken(stateDir, "bot_media", "user_media", "ctx_media");
}

function fakeMediaClient(options = {}) {
  const calls = {
    getUploadUrl: [],
    uploadBytes: [],
    sendMediaMessage: [],
    getConfig: [],
    sendTyping: []
  };

  return {
    calls,
    async getUploadUrl(request) {
      calls.getUploadUrl.push(request);
      return options.uploadConfig ?? {
        ret: 0,
        upload_param: "upload_param_fixture"
      };
    },
    async uploadBytes(request) {
      calls.uploadBytes.push(request);
      if (options.uploadError) {
        throw options.uploadError;
      }
      return {
        status: 200,
        headers: { "x-encrypted-param": "download_param_fixture" },
        body: { ret: 0 }
      };
    },
    async sendMediaMessage(request) {
      calls.sendMediaMessage.push(request);
      if (options.sendError) {
        throw options.sendError;
      }
      return { ret: 0 };
    },
    async getConfig(request) {
      calls.getConfig.push(request);
      if (options.configError) {
        throw options.configError;
      }
      return options.configResponse ?? {
        ret: 0,
        typing_ticket: "typing_ticket",
        context_token: "ctx_media_refreshed"
      };
    },
    async sendTyping(request) {
      calls.sendTyping.push(request);
      const failure = options.typingFailAt === calls.sendTyping.length ? options.typingError : undefined;
      if (failure) {
        throw failure;
      }
      return { ret: 0 };
    }
  };
}

test("sendMedia uploads encrypted image bytes, sends media message, and writes safe history", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const imagePath = path.join(stateDir, "sample.png");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
    const client = fakeMediaClient();

    const result = await sendMedia({
      stateDir,
      userId: "user_media",
      filePath: imagePath,
      kind: "image",
      client,
      config: { maxUploadBytes: 1024, cdnBaseUrl: "https://upload.example/c2c" }
    });

    assert.equal(result.kind, "image");
    assert.equal(result.fileName, "sample.png");
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.bytes, 6);
    assert.equal(result.uploaded, true);
    assert.equal(result.sent, true);
    assert.equal(JSON.stringify(result).includes("ctx_media"), false);
    assert.equal(JSON.stringify(result).includes("bot_secret_media"), false);

    assert.equal(client.calls.getUploadUrl.length, 1);
    assert.equal(client.calls.getUploadUrl[0].token, "bot_secret_media");
    assert.equal(client.calls.getUploadUrl[0].upload.media_type, 1);
    assert.equal(client.calls.getUploadUrl[0].upload.to_user_id, "user_media");
    assert.equal(client.calls.getUploadUrl[0].upload.rawsize, 6);
    assert.match(client.calls.getUploadUrl[0].upload.rawfilemd5, /^[a-f0-9]{32}$/);
    assert.match(client.calls.getUploadUrl[0].upload.aeskey, /^[a-f0-9]{32}$/);

    assert.equal(client.calls.uploadBytes.length, 1);
    assert.match(client.calls.uploadBytes[0].uploadUrl, /^https:\/\/upload\.example\/c2c\/upload\?/);
    assert.match(client.calls.uploadBytes[0].uploadUrl, /encrypted_query_param=upload_param_fixture/);
    assert.match(client.calls.uploadBytes[0].uploadUrl, /filekey=[a-f0-9]{32}/);
    assert.ok(Buffer.isBuffer(client.calls.uploadBytes[0].bytes));
    assert.notEqual(client.calls.uploadBytes[0].bytes.toString("hex"), (await readFile(imagePath)).toString("hex"));

    const send = client.calls.sendMediaMessage[0];
    assert.equal(send.toUserId, "user_media");
    assert.equal(send.contextToken, "ctx_media");
    assert.equal(send.item.type, 2);
    assert.equal(send.item.image_item.media.encrypt_query_param, "download_param_fixture");
    assert.match(send.item.image_item.media.aes_key, /^[A-Za-z0-9+/]+=*$/);
    assert.equal(send.item.image_item.media.encrypt_type, 1);
    assert.equal(send.item.image_item.mid_size, client.calls.uploadBytes[0].bytes.length);
    assert.match(send.clientId, /^wxb-\d+-[a-f0-9]{8}$/);

    const history = await readMessageHistory(stateDir, "bot_media");
    assert.equal(history.length, 1);
    assert.equal(history[0].type, "image");
    assert.match(history[0].attachment.fileKey, /^[a-f0-9]{32}$/);
    assert.equal(history[0].attachment.fileName, "sample.png");
  });
});

test("sendMedia supports typing and refreshed context tokens", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const filePath = path.join(stateDir, "report.pdf");
    await writeFile(filePath, Buffer.from("%PDF fixture"));
    const client = fakeMediaClient();

    const result = await sendMedia({
      stateDir,
      userId: "user_media",
      filePath,
      kind: "file",
      client,
      typing: true,
      config: { maxUploadBytes: 1024, cdnBaseUrl: "https://upload.example/c2c" }
    });

    assert.deepEqual(client.calls.sendTyping.map((call) => call.status), [1, 2]);
    assert.equal(client.calls.getConfig[0].contextToken, "ctx_media");
    assert.equal(client.calls.sendMediaMessage[0].contextToken, "ctx_media_refreshed");
    assert.equal(await resolveContextToken(stateDir, "bot_media", "user_media"), "ctx_media_refreshed");
    assert.equal(result.typing.started, true);
    assert.equal(result.typing.stopped, true);
  });
});

test("sendMedia continues delivery when typing ticket is missing", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const filePath = path.join(stateDir, "report.pdf");
    await writeFile(filePath, Buffer.from("%PDF fixture"));
    const client = fakeMediaClient({
      configResponse: {
        ret: 0,
        context_token: "ctx_media_refreshed"
      }
    });

    const result = await sendMedia({
      stateDir,
      userId: "user_media",
      filePath,
      kind: "file",
      client,
      typing: true,
      config: { maxUploadBytes: 1024, cdnBaseUrl: "https://upload.example/c2c" }
    });

    assert.equal(client.calls.getConfig.length, 1);
    assert.equal(client.calls.sendTyping.length, 0);
    assert.equal(client.calls.sendMediaMessage.length, 1);
    assert.equal(client.calls.sendMediaMessage[0].contextToken, "ctx_media_refreshed");
    assert.equal(await resolveContextToken(stateDir, "bot_media", "user_media"), "ctx_media_refreshed");
    assert.equal(result.sent, true);
    assert.equal(result.typing.requested, true);
    assert.equal(result.typing.started, false);
    assert.equal(result.typing.stopped, false);
    assert.equal(result.typing.startError.code, "TYPING_TICKET_MISSING");
    assert.equal(JSON.stringify(result).includes("ctx_media"), false);
    assert.equal(JSON.stringify(result).includes("bot_secret_media"), false);
  });
});

test("sendMedia reports local file validation failures before contacting the client", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const client = fakeMediaClient();

    await assert.rejects(
      sendMedia({
        stateDir,
        userId: "user_media",
        filePath: path.join(stateDir, "missing.png"),
        kind: "image",
        client
      }),
      (error) => error.code === "MEDIA_FILE_NOT_FOUND"
    );

    const dirPath = path.join(stateDir, "folder.pdf");
    await mkdir(dirPath);
    await assert.rejects(
      sendMedia({
        stateDir,
        userId: "user_media",
        filePath: dirPath,
        kind: "file",
        client
      }),
      (error) => error.code === "MEDIA_PATH_NOT_FILE"
    );

    const tooLargePath = path.join(stateDir, "large.pdf");
    await writeFile(tooLargePath, Buffer.alloc(4));
    await assert.rejects(
      sendMedia({
        stateDir,
        userId: "user_media",
        filePath: tooLargePath,
        kind: "file",
        client,
        config: { maxUploadBytes: 3 }
      }),
      (error) => error.code === "MEDIA_FILE_TOO_LARGE"
    );

    const unknownPath = path.join(stateDir, "unknown.bin");
    await writeFile(unknownPath, Buffer.from("unknown"));
    await assert.rejects(
      sendMedia({
        stateDir,
        userId: "user_media",
        filePath: unknownPath,
        kind: "file",
        client
      }),
      (error) => error.code === "MEDIA_TYPE_UNSUPPORTED"
    );

    assert.equal(client.calls.getUploadUrl.length, 0);
    assert.equal(client.calls.uploadBytes.length, 0);
    assert.equal(client.calls.sendMediaMessage.length, 0);
  });
});

test("sendMedia reports upload failures without sending media message", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const filePath = path.join(stateDir, "broken.pdf");
    await writeFile(filePath, Buffer.from("%PDF fixture"));
    const client = fakeMediaClient({
      uploadError: new Error("upload unavailable")
    });

    await assert.rejects(
      sendMedia({
        stateDir,
        userId: "user_media",
        filePath,
        kind: "file",
        client,
        config: { maxUploadBytes: 1024, cdnBaseUrl: "https://upload.example/c2c" }
      }),
      (error) => {
        assert.equal(error.code, "MEDIA_UPLOAD_FAILED");
        assert.equal(error.details.cause, "upload unavailable");
        return true;
      }
    );

    assert.equal(client.calls.uploadBytes.length, 1);
    assert.equal(client.calls.sendMediaMessage.length, 0);
    assert.equal((await readMessageHistory(stateDir, "bot_media")).length, 0);
  });
});

test("sendMedia reports upload success metadata when sendmessage later fails", async () => {
  await withTempDir(async (stateDir) => {
    await seedAccount(stateDir);
    const filePath = path.join(stateDir, "report.pdf");
    await writeFile(filePath, Buffer.from("%PDF fixture"));
    const client = fakeMediaClient({
      sendError: new WxbError("SESSION_EXPIRED", "expired", { retryable: false })
    });

    await assert.rejects(
      sendMedia({
        stateDir,
        userId: "user_media",
        filePath,
        kind: "file",
        client,
        config: { maxUploadBytes: 1024, cdnBaseUrl: "https://upload.example/c2c" }
      }),
      (error) => {
        assert.equal(error.code, "SESSION_EXPIRED");
        assert.equal(error.details.uploaded, true);
        assert.equal(error.details.fileName, "report.pdf");
        assert.match(error.details.clientId, /^wxb-\d+-[a-f0-9]{8}$/);
        return true;
      }
    );

    assert.equal(client.calls.uploadBytes.length, 1);
    assert.equal((await readMessageHistory(stateDir, "bot_media")).length, 0);
  });
});
