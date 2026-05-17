import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { startMockIlinkServer } from "../helpers/mock-ilink-server.js";
import { rememberContextToken } from "../../src/state/context-token-store.js";
import { readMessageHistory } from "../../src/state/message-history.js";

const execFileAsync = promisify(execFile);

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-m11 状态 "));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCli(args, options = {}) {
  return execFileAsync(process.execPath, [path.resolve("src", "cli", "index.js"), ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      ...options.env
    }
  });
}

async function loginFixtureAccount(server, stateDir) {
  await runCli([
    "login",
    "--quiet",
    "--base-url", server.baseUrl,
    "--state-dir", stateDir,
    "--poll-interval-ms", "0",
    "--max-polls", "1"
  ]);
}

test("wxb send --image uploads media, sends typing status, and hides upload secrets", async () => {
  await withTempDir(async (stateDir) => {
    const imagePath = path.join(stateDir, "sample.jpg");
    await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]));
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_m11",
          ilink_bot_id: "bot_m11",
          ilink_user_id: "owner_m11"
        }
      ],
      getConfigResponses: [
        {
          ret: 0,
          typing_ticket: "typing_ticket_m11",
          context_token: "ctx_secret_m11_refreshed"
        }
      ],
      getUploadUrlResponses: [
        {
          ret: 0,
          upload_param: "upload_param_m11"
        }
      ],
      uploadResponses: {
        "/upload": {
          headers: {
            "x-encrypted-param": "download_param_m11"
          },
          body: { ret: 0 }
        }
      },
      sendMessageResponses: [{ ret: 0 }]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      await rememberContextToken(stateDir, "bot_m11", "user_m11", "ctx_secret_m11");

      const { stdout } = await runCli([
        "send",
        "--state-dir", stateDir,
        "--cdn-base-url", server.baseUrl,
        "--user", "user_m11",
        "--image", imagePath,
        "--typing",
        "--timeout", "1000"
      ]);
      const parsed = JSON.parse(stdout);

      assert.equal(parsed.ok, true);
      assert.equal(parsed.data.kind, "image");
      assert.equal(parsed.data.fileName, "sample.jpg");
      assert.equal(parsed.data.mimeType, "image/jpeg");
      assert.equal(parsed.data.typing.started, true);
      assert.equal(parsed.data.typing.stopped, true);
      assert.equal(stdout.includes("ctx_secret_m11"), false);
      assert.equal(stdout.includes("bot_secret_m11"), false);
      assert.equal(stdout.includes("typing_ticket_m11"), false);
      assert.equal(stdout.includes("upload_param_m11"), false);
      assert.equal(stdout.includes("download_param_m11"), false);

      const getConfigRequest = server.requests.find((request) => request.pathname === "/ilink/bot/getconfig");
      assert.equal(getConfigRequest.body.ilink_user_id, "user_m11");
      assert.equal(getConfigRequest.body.context_token, "ctx_secret_m11");

      const typingRequests = server.requests.filter((request) => request.pathname === "/ilink/bot/sendtyping");
      assert.deepEqual(typingRequests.map((request) => request.body.status), [1, 2]);
      assert.equal(typingRequests[0].body.typing_ticket, "typing_ticket_m11");

      const uploadUrlRequest = server.requests.find((request) => request.pathname === "/ilink/bot/getuploadurl");
      assert.equal(uploadUrlRequest.headers.authorization, "Bearer bot_secret_m11");
      assert.equal(uploadUrlRequest.body.to_user_id, "user_m11");
      assert.equal(uploadUrlRequest.body.media_type, 1);
      assert.equal(uploadUrlRequest.body.rawsize, 6);
      assert.match(uploadUrlRequest.body.filekey, /^[a-f0-9]{32}$/);
      assert.match(uploadUrlRequest.body.aeskey, /^[a-f0-9]{32}$/);

      const uploadRequest = server.requests.find((request) => request.pathname === "/upload");
      assert.equal(uploadRequest.searchParams.encrypted_query_param, "upload_param_m11");
      assert.match(uploadRequest.searchParams.filekey, /^[a-f0-9]{32}$/);
      assert.ok(Buffer.isBuffer(uploadRequest.body));
      assert.ok(uploadRequest.body.length > 6);

      const sendRequest = server.requests.find((request) => request.pathname === "/ilink/bot/sendmessage");
      assert.equal(sendRequest.body.msg.context_token, "ctx_secret_m11_refreshed");
      assert.equal(sendRequest.body.msg.item_list[0].type, 2);
      assert.equal(sendRequest.body.msg.item_list[0].image_item.media.encrypt_query_param, "download_param_m11");
      assert.match(sendRequest.body.msg.item_list[0].image_item.media.aes_key, /^[A-Za-z0-9+/]+=*$/);
      assert.equal(sendRequest.body.msg.item_list[0].image_item.media.encrypt_type, 1);

      const history = await readMessageHistory(stateDir, "bot_m11");
      assert.equal(history.length, 1);
      assert.equal(history[0].type, "image");
      assert.equal(history[0].attachment.fileName, "sample.jpg");
    } finally {
      await server.close();
    }
  });
});

test("wxb send reports media validation and source errors as structured JSON", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_m11",
          ilink_bot_id: "bot_m11",
          ilink_user_id: "owner_m11"
        }
      ]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      await rememberContextToken(stateDir, "bot_m11", "user_m11", "ctx_secret_m11");

      await assert.rejects(
        runCli([
          "send",
          "--state-dir", stateDir,
          "--user", "user_m11",
          "--text", "hello",
          "--file", path.join(stateDir, "missing.pdf")
        ]),
        (error) => {
          const parsed = JSON.parse(error.stdout);
          assert.equal(parsed.error.code, "SEND_SOURCE_AMBIGUOUS");
          return true;
        }
      );

      await assert.rejects(
        runCli([
          "send",
          "--state-dir", stateDir,
          "--user", "user_m11",
          "--file", path.join(stateDir, "missing.pdf")
        ]),
        (error) => {
          const parsed = JSON.parse(error.stdout);
          assert.equal(parsed.error.code, "MEDIA_FILE_NOT_FOUND");
          return true;
        }
      );
    } finally {
      await server.close();
    }
  });
});

test("wxb send reports upload failures before sendmessage", async () => {
  await withTempDir(async (stateDir) => {
    const filePath = path.join(stateDir, "broken.png");
    await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_m11",
          ilink_bot_id: "bot_m11",
          ilink_user_id: "owner_m11"
        }
      ],
      getUploadUrlResponses: [
        {
          ret: 0,
          upload_param: "upload_param_m11_fail"
        }
      ],
      uploadResponses: {
        "/upload": {
          httpStatus: 500,
          body: { ret: 500, errmsg: "cdn failed" }
        }
      }
    });

    try {
      await loginFixtureAccount(server, stateDir);
      await rememberContextToken(stateDir, "bot_m11", "user_m11", "ctx_secret_m11");

      await assert.rejects(
        runCli([
          "send",
          "--state-dir", stateDir,
          "--cdn-base-url", server.baseUrl,
          "--user", "user_m11",
          "--image", filePath,
          "--timeout", "1000"
        ]),
        (error) => {
          const parsed = JSON.parse(error.stdout);
          assert.equal(parsed.error.code, "MEDIA_UPLOAD_FAILED");
          assert.equal(error.stdout.includes("upload_param_m11_fail"), false);
          assert.equal(error.stdout.includes("ctx_secret_m11"), false);
          return true;
        }
      );

      assert.ok(server.requests.some((request) => request.pathname === "/upload"));
      assert.equal(server.requests.some((request) => request.pathname === "/ilink/bot/sendmessage"), false);
    } finally {
      await server.close();
    }
  });
});
