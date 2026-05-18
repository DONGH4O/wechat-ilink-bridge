import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { once } from "node:events";
import { appendMessageHistory } from "../../src/state/message-history.js";
import { MCP_PROTOCOL_VERSION, callMcpTool, handleMcpRequest, listMcpTools } from "../../src/mcp/tools.js";
import { rememberContextToken } from "../../src/state/context-token-store.js";
import { saveAccount } from "../../src/state/account-store.js";
import { setAlias } from "../../src/state/alias-store.js";
import { startMcpStdioServer } from "../../src/mcp/stdio-server.js";
import { startMockIlinkServer } from "../helpers/mock-ilink-server.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb mcp 状态 "));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseToolPayload(result) {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

async function loadFixture(name) {
  const content = await readFile(path.resolve("test", "fixtures", "raw", name), "utf8");
  return JSON.parse(content);
}

function makeContext(stateDir, server) {
  return {
    config: {
      stateDir,
      baseUrl: server.baseUrl,
      cdnBaseUrl: server.baseUrl,
      fetchTimeoutMs: 1000,
      maxChunkChars: 3800,
      minChunkChars: 20,
      maxDeliveryMessages: 10,
      maxUploadBytes: 25 * 1024 * 1024
    },
    retryDelaysMs: [0]
  };
}

test("MCP tool schemas do not expose bridge-managed secrets", () => {
  const schemaText = JSON.stringify(listMcpTools());

  assert.equal(/context_?token/i.test(schemaText), false);
  assert.equal(/bot_?token/i.test(schemaText), false);
  assert.equal(/aes_?key/i.test(schemaText), false);
  assert.equal(/upload_?url/i.test(schemaText), false);
  assert.equal(/cdn_?url/i.test(schemaText), false);
});

test("MCP adapter lists tools and handles initialize", async () => {
  const initResponse = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION }
  });
  assert.equal(initResponse.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(initResponse.result.capabilities, { tools: {} });

  const unsupportedInitResponse = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 11,
    method: "initialize",
    params: { protocolVersion: "test-protocol" }
  });
  assert.equal(unsupportedInitResponse.result.protocolVersion, MCP_PROTOCOL_VERSION);

  const listResponse = await handleMcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  });
  assert.equal(listResponse.result.tools.some((tool) => tool.name === "fetchMessages"), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === "sendText"), true);
  assert.equal(listResponse.result.tools.some((tool) => tool.name === "sendFile"), true);
});

test("MCP stdio server handles newline-delimited JSON-RPC", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdout.setEncoding("utf8");
  startMcpStdioServer({ stdin, stdout });

  const dataPromise = once(stdout, "data");
  stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list"
  })}\n`);

  const [chunk] = await dataPromise;
  const response = JSON.parse(chunk.trim());
  assert.equal(response.jsonrpc, "2.0");
  assert.equal(response.id, 1);
  assert.equal(response.result.tools.some((tool) => tool.name === "status"), true);
  stdin.end();
});

test("MCP tools complete status, fetch, send, file send, and listUsers with mock iLink", async () => {
  await withTempDir(async (stateDir) => {
    const fixture = await loadFixture("getupdates-text-message.json");
    const server = await startMockIlinkServer({
      getUpdatesResponses: [fixture],
      sendMessageResponses: [{ ret: 0 }, { ret: 0 }]
    });

    try {
      await saveAccount(stateDir, {
        accountId: "bot_mcp",
        token: "bot_secret_mcp",
        baseUrl: server.baseUrl,
        ownerUserId: "bot_owner_001"
      });
      await setAlias(stateDir, "user_opaque_001", "MCP测试用户");
      const context = makeContext(stateDir, server);

      const statusPayload = parseToolPayload(await callMcpTool("status", { accountId: "bot_mcp" }, context));
      assert.equal(statusPayload.ok, true);
      assert.equal(statusPayload.data.accounts[0].accountId, "bot_mcp");
      assert.equal(JSON.stringify(statusPayload).includes("bot_secret_mcp"), false);

      const fetchResult = await callMcpTool("fetchMessages", {
        accountId: "bot_mcp",
        maxAttempts: 1
      }, context);
      const fetchPayload = parseToolPayload(fetchResult);
      assert.equal(fetchPayload.ok, true);
      assert.equal(fetchPayload.data.messages.length, 1);
      assert.equal(fetchPayload.data.messages[0].fromUserId, "user_opaque_001");
      assert.equal(fetchPayload.data.messages[0].hasContextToken, true);
      assert.equal(fetchResult.content[0].text.includes("ctx_text_001_should_not_escape"), false);
      assert.equal(fetchResult.content[0].text.includes("bot_secret_mcp"), false);

      const sendTextResult = await callMcpTool("sendText", {
        accountId: "bot_mcp",
        userId: "user_opaque_001",
        text: "M14 MCP text reply"
      }, context);
      const sendTextPayload = parseToolPayload(sendTextResult);
      assert.equal(sendTextPayload.ok, true);
      assert.equal(sendTextPayload.data.toUserId, "user_opaque_001");
      assert.equal(sendTextResult.content[0].text.includes("ctx_text_001_should_not_escape"), false);

      const filePath = path.join(stateDir, "mcp-report.txt");
      await writeFile(filePath, "M14 file body", "utf8");
      const sendFileResult = await callMcpTool("sendFile", {
        accountId: "bot_mcp",
        userId: "user_opaque_001",
        filePath,
        kind: "file"
      }, context);
      const sendFilePayload = parseToolPayload(sendFileResult);
      assert.equal(sendFilePayload.ok, true);
      assert.equal(sendFilePayload.data.sent, true);
      assert.equal(sendFilePayload.data.fileName, "mcp-report.txt");
      assert.equal(sendFileResult.content[0].text.includes("upload_param_fixture"), false);
      assert.equal(sendFileResult.content[0].text.includes("download_param_fixture"), false);

      const listUsersPayload = parseToolPayload(await callMcpTool("listUsers", { accountId: "bot_mcp" }, context));
      assert.equal(listUsersPayload.ok, true);
      assert.equal(listUsersPayload.data.accounts[0].users[0].userId, "user_opaque_001");
      assert.equal(listUsersPayload.data.accounts[0].users[0].alias, "MCP测试用户");
      assert.equal(listUsersPayload.data.accounts[0].users[0].hasContextToken, true);

      const sendRequests = server.requests.filter((request) => request.pathname === "/ilink/bot/sendmessage");
      assert.equal(sendRequests.length, 2);
      assert.equal(sendRequests[0].body.msg.context_token, "ctx_text_001_should_not_escape");
      assert.equal(server.requests.some((request) => request.pathname === "/ilink/bot/getuploadurl"), true);
      assert.equal(server.requests.some((request) => request.pathname === "/upload"), true);
    } finally {
      await server.close();
    }
  });
});

test("MCP tool failures preserve CLI error shape and reject secret arguments", async () => {
  await withTempDir(async (stateDir) => {
    const server = await startMockIlinkServer();
    try {
      await saveAccount(stateDir, {
        accountId: "bot_mcp",
        token: "bot_secret_mcp",
        baseUrl: server.baseUrl,
        ownerUserId: "owner_mcp"
      });
      const context = makeContext(stateDir, server);

      const missingContext = await callMcpTool("sendText", {
        accountId: "bot_mcp",
        userId: "user_without_context",
        text: "hello"
      }, context);
      const missingContextPayload = parseToolPayload(missingContext);
      assert.equal(missingContext.isError, true);
      assert.equal(missingContextPayload.ok, false);
      assert.equal(missingContextPayload.error.code, "NO_CONTEXT_TOKEN");

      const secretArg = await callMcpTool("sendText", {
        accountId: "bot_mcp",
        userId: "user_without_context",
        text: "hello",
        context_token: "should_not_be_accepted"
      }, context);
      const secretArgPayload = parseToolPayload(secretArg);
      assert.equal(secretArg.isError, true);
      assert.equal(secretArgPayload.error.code, "MCP_SECRET_ARGUMENT_UNSUPPORTED");
      assert.equal(secretArg.content[0].text.includes("should_not_be_accepted"), false);

      const nestedSecretArg = await callMcpTool("sendText", {
        accountId: "bot_mcp",
        userId: "user_without_context",
        text: "hello",
        metadata: {
          contextToken: "nested_secret_should_not_be_accepted"
        }
      }, context);
      const nestedSecretPayload = parseToolPayload(nestedSecretArg);
      assert.equal(nestedSecretArg.isError, true);
      assert.equal(nestedSecretPayload.error.code, "MCP_SECRET_ARGUMENT_UNSUPPORTED");
      assert.equal(nestedSecretArg.content[0].text.includes("nested_secret_should_not_be_accepted"), false);
    } finally {
      await server.close();
    }
  });
});

test("listUsers derives reply-ready users without exposing context values", async () => {
  await withTempDir(async (stateDir) => {
    await saveAccount(stateDir, {
      accountId: "bot_list",
      token: "bot_secret_list",
      ownerUserId: "owner_list"
    });
    await rememberContextToken(stateDir, "bot_list", "user_list", "ctx_list_secret");
    await appendMessageHistory(stateDir, "bot_list", {
      id: "history_1",
      direction: "incoming",
      fromUserId: "user_list",
      toUserId: "owner_list",
      timestamp: 1715000100,
      type: "text",
      text: "hello"
    });

    const payload = parseToolPayload(await callMcpTool("listUsers", { accountId: "bot_list" }, {
      config: { stateDir }
    }));

    assert.equal(payload.ok, true);
    assert.equal(payload.data.userCount, 1);
    assert.equal(payload.data.accounts[0].users[0].hasContextToken, true);
    assert.equal(JSON.stringify(payload).includes("ctx_list_secret"), false);
    assert.equal(JSON.stringify(payload).includes("bot_secret_list"), false);
  });
});

test("M14 docs and package expose the MCP adapter contract", async () => {
  const [packageJson, readme, adapterDoc, validationReport, apiReference] = await Promise.all([
    readFile("package.json", "utf8"),
    readFile("README.md", "utf8"),
    readFile("docs/m14-mcp-adapter.md", "utf8"),
    readFile("docs/m14-validation-report.md", "utf8"),
    readFile("skills/wechat-bridge/references/api.md", "utf8")
  ]);
  const pkg = JSON.parse(packageJson);

  assert.equal(pkg.bin["wxb-mcp"], "src/mcp/index.js");
  for (const content of [readme, adapterDoc, validationReport, apiReference]) {
    assert.match(content, /wxb-mcp/);
    assert.match(content, /fetchMessages/);
    assert.match(content, /sendText/);
    assert.match(content, /sendFile/);
    assert.match(content, /listUsers/);
    assert.match(content, /status/);
  }
  assert.match(adapterDoc, /attachments\[\]\.path/);
  assert.match(validationReport, /NO_CONTEXT_TOKEN/);
});
