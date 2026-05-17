import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createCipheriv } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { startMockIlinkServer } from "../helpers/mock-ilink-server.js";

const execFileAsync = promisify(execFile);

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-m8 状态 "));
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

function encryptAes128Ecb(buffer, keyHex) {
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(keyHex, "hex"), null);
  return Buffer.concat([cipher.update(buffer), cipher.final()]);
}

test("wxb fetch --download-media saves image attachments and returns absolute paths", async () => {
  await withTempDir(async (stateDir) => {
    const keyHex = "00112233445566778899aabbccddeeff";
    const encrypted = encryptAes128Ecb(Buffer.from("image payload"), keyHex);
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_m8",
          ilink_bot_id: "bot_m8",
          ilink_user_id: "owner_m8"
        }
      ],
      getUpdatesResponses: [
        {
          ret: 0,
          get_updates_buf: "cursor_m8",
          msgs: [
            {
              msg_id: "msg_m8_image",
              from_user_id: "user_m8",
              context_token: "ctx_secret_m8",
              timestamp: 1778949153,
              item_list: [
                {
                  type: 3,
                  image_item: {
                    file_id: "image_file_m8",
                    file_name: "../sample:image?.jpg",
                    mime_type: "image/jpeg",
                    cdn_url: "/media/sample-image",
                    aeskey: keyHex
                  }
                }
              ]
            }
          ]
        }
      ],
      mediaResponses: {
        "/media/sample-image": {
          body: encrypted,
          contentType: "application/octet-stream"
        }
      }
    });

    try {
      await loginFixtureAccount(server, stateDir);
      const parsed = JSON.parse((await runCli([
        "fetch",
        "--state-dir", stateDir,
        "--cdn-base-url", server.baseUrl,
        "--download-media",
        "--timeout", "1000",
        "--max-attempts", "1"
      ])).stdout);

      const [message] = parsed.data.messages;
      assert.equal(parsed.ok, true);
      assert.equal(message.type, "image");
      assert.equal(message.mediaDownload.succeeded, 1);
      assert.equal(message.attachments.length, 1);
      assert.equal(path.isAbsolute(message.attachments[0].path), true);
      assert.equal(message.attachments[0].path.startsWith(path.resolve(stateDir, "inbox")), true);
      assert.equal((await readFile(message.attachments[0].path)).toString("utf8"), "image payload");
      assert.equal(JSON.stringify(parsed).includes("ctx_secret_m8"), false);
      assert.equal(JSON.stringify(parsed).includes(keyHex), false);
      assert.equal(JSON.stringify(parsed).includes("/media/sample-image"), false);
    } finally {
      await server.close();
    }
  });
});
