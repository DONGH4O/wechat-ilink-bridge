import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { startMockIlinkServer } from "../helpers/mock-ilink-server.js";
import { rememberContextToken } from "../../src/state/context-token-store.js";
import { readMessageHistory } from "../../src/state/message-history.js";

const execFileAsync = promisify(execFile);

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb send 状态 "));
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

async function runCliWithInput(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("src", "cli", "index.js"), ...args], {
      cwd: path.resolve("."),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`Command exited with code ${code}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    child.stdin.end(input, "utf8");
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

test("wxb send posts text with cached context token and hides secrets from stdout", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_send",
          ilink_bot_id: "bot_send",
          ilink_user_id: "owner_send"
        }
      ],
      sendMessageResponses: [{ ret: 0 }]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      await rememberContextToken(stateDir, "bot_send", "user_send", "ctx_secret_send");

      const { stdout } = await runCli([
        "send",
        "--state-dir", stateDir,
        "--user", "user_send",
        "--text", "你好，M4",
        "--json"
      ]);
      const parsed = JSON.parse(stdout);

      assert.equal(parsed.ok, true);
      assert.equal(parsed.data.toUserId, "user_send");
      assert.equal(parsed.data.chunkCount, 1);
      assert.equal(stdout.includes("ctx_secret_send"), false);
      assert.equal(stdout.includes("bot_secret_send"), false);

      const sendRequest = server.requests.find((request) => request.pathname === "/ilink/bot/sendmessage");
      assert.equal(sendRequest.headers.authorizationtype, "ilink_bot_token");
      assert.equal(sendRequest.headers.authorization, "Bearer bot_secret_send");
      assert.match(sendRequest.headers["x-wechat-uin"], /^[A-Za-z0-9+/]+=*$/);
      assert.equal(sendRequest.body.msg.to_user_id, "user_send");
      assert.equal(sendRequest.body.msg.context_token, "ctx_secret_send");
      assert.equal(sendRequest.body.msg.item_list[0].text_item.text, "你好，M4");
      assert.match(sendRequest.body.msg.client_id, /^wxb-\d+-[a-f0-9]{8}$/);

      const history = await readMessageHistory(stateDir, "bot_send");
      assert.equal(history.length, 1);
      assert.equal(history[0].direction, "outgoing");
      assert.equal(history[0].text, "你好，M4");
    } finally {
      await server.close();
    }
  });
});

test("wxb send supports stdin input", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_send",
          ilink_bot_id: "bot_send",
          ilink_user_id: "owner_send"
        }
      ],
      sendMessageResponses: [{ ret: 0 }]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      await rememberContextToken(stateDir, "bot_send", "user_send", "ctx_secret_send");
      const { stdout } = await runCliWithInput([
        "send",
        "--state-dir", stateDir,
        "--user", "user_send",
        "--stdin"
      ], "来自 stdin 的中文");
      const parsed = JSON.parse(stdout);

      assert.equal(parsed.ok, true);
      const sendRequests = server.requests.filter((request) => request.pathname === "/ilink/bot/sendmessage");
      assert.equal(sendRequests.at(-1).body.msg.item_list[0].text_item.text, "来自 stdin 的中文");
    } finally {
      await server.close();
    }
  });
});

test("wxb send returns NO_CONTEXT_TOKEN before calling sendmessage", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer({
      statusResponses: [
        {
          status: "confirmed",
          bot_token: "bot_secret_send",
          ilink_bot_id: "bot_send",
          ilink_user_id: "owner_send"
        }
      ]
    });

    try {
      await loginFixtureAccount(server, stateDir);
      await assert.rejects(
        runCli([
          "send",
          "--state-dir", stateDir,
          "--user", "user_without_context",
          "--text", "hello"
        ]),
        (error) => {
          const parsed = JSON.parse(error.stdout);
          assert.equal(parsed.error.code, "NO_CONTEXT_TOKEN");
          assert.equal(parsed.error.details.userId, "user_without_context");
          return true;
        }
      );
      assert.equal(server.requests.some((request) => request.pathname === "/ilink/bot/sendmessage"), false);
    } finally {
      await server.close();
    }
  });
});

test("wxb send reports invalid timeout as a structured config error", async () => {
  await assert.rejects(
    runCli(["send", "--timeout", "nope", "--user", "user_send", "--text", "hello"]),
    (error) => {
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "CONFIG_VALUE_INVALID");
      assert.equal(parsed.error.details.key, "timeout");
      assert.equal(parsed.error.details.value, "nope");
      return true;
    }
  );
});
