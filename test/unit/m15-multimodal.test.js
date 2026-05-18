import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { callMcpTool, listMcpTools } from "../../src/mcp/tools.js";
import { appendMessageHistory, readMessageHistory } from "../../src/state/message-history.js";
import { rememberContextToken, resolveContextToken } from "../../src/state/context-token-store.js";
import { markSeenIds, readSeenIds } from "../../src/state/seen-store.js";
import { readSyncBuffer, writeSyncBuffer } from "../../src/state/sync-buffer-store.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb m15 状态 "));
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

test("M15 analyzeMedia schema is optional and does not accept model secrets", () => {
  const tools = listMcpTools();
  const analyzeMedia = tools.find((tool) => tool.name === "analyzeMedia");
  const schemaText = JSON.stringify(analyzeMedia);

  assert.ok(analyzeMedia);
  assert.match(schemaText, /imageQuestion/);
  assert.match(schemaText, /transcribeAudio/);
  assert.match(schemaText, /summarizeVideo/);
  assert.equal(/api_?key/i.test(schemaText), false);
  assert.equal(/context_?token/i.test(schemaText), false);
});

test("M15 analyzeMedia returns metadata and local text extraction through MCP", async () => {
  await withTempDir(async (stateDir) => {
    const filePath = path.join(stateDir, "message.txt");
    await writeFile(filePath, "local text body", "utf8");

    const inspectPayload = parseToolPayload(await callMcpTool("analyzeMedia", {
      filePath,
      mode: "inspect"
    }, {
      config: { stateDir }
    }));

    assert.equal(inspectPayload.ok, true);
    assert.equal(inspectPayload.data.media.fileName, "message.txt");
    assert.equal(inspectPayload.data.media.kind, "text");
    assert.equal(inspectPayload.data.analysis.status, "metadata_only");

    const textPayload = parseToolPayload(await callMcpTool("analyzeMedia", {
      filePath,
      mode: "extractText"
    }, {
      config: { stateDir }
    }));

    assert.equal(textPayload.ok, true);
    assert.equal(textPayload.data.analysis.status, "completed");
    assert.equal(textPayload.data.analysis.text, "local text body");
  });
});

test("M15 analyzeMedia degrades without model helper and rejects secret arguments", async () => {
  await withTempDir(async (stateDir) => {
    const filePath = path.join(stateDir, "image.png");
    await writeFile(filePath, Buffer.from("not-real-image"));

    const missingHelper = await callMcpTool("analyzeMedia", {
      filePath,
      mode: "imageQuestion",
      question: "describe this"
    }, {
      config: { stateDir }
    });
    const missingHelperPayload = parseToolPayload(missingHelper);

    assert.equal(missingHelperPayload.ok, true);
    assert.equal(missingHelperPayload.data.analysis.status, "unavailable");
    assert.equal(missingHelperPayload.data.analysis.code, "MULTIMODAL_HELPER_UNAVAILABLE");

    const secretArg = await callMcpTool("analyzeMedia", {
      filePath,
      mode: "imageQuestion",
      apiKey: "should_not_be_accepted"
    }, {
      config: { stateDir }
    });
    const secretArgPayload = parseToolPayload(secretArg);

    assert.equal(secretArg.isError, true);
    assert.equal(secretArgPayload.error.code, "MCP_SECRET_ARGUMENT_UNSUPPORTED");
    assert.equal(secretArg.content[0].text.includes("should_not_be_accepted"), false);

    const nestedSecretArg = await callMcpTool("analyzeMedia", {
      filePath,
      mode: "imageQuestion",
      helperConfig: {
        modelApiKey: "nested_secret_should_not_be_accepted"
      }
    }, {
      config: { stateDir }
    });
    const nestedSecretArgPayload = parseToolPayload(nestedSecretArg);

    assert.equal(nestedSecretArg.isError, true);
    assert.equal(nestedSecretArgPayload.error.code, "MCP_SECRET_ARGUMENT_UNSUPPORTED");
    assert.equal(nestedSecretArg.content[0].text.includes("nested_secret_should_not_be_accepted"), false);
  });
});

test("M15 optional helper failures do not mutate route state", async () => {
  await withTempDir(async (stateDir) => {
    const filePath = path.join(stateDir, "voice.mp3");
    await writeFile(filePath, Buffer.from("ID3fixture"));
    await rememberContextToken(stateDir, "bot_m15", "user_m15", "ctx_m15_secret");
    await writeSyncBuffer(stateDir, "bot_m15", "cursor-before-helper");
    await markSeenIds(stateDir, "bot_m15", ["seen-before-helper"]);
    await appendMessageHistory(stateDir, "bot_m15", {
      id: "history-before-helper",
      direction: "incoming",
      fromUserId: "user_m15",
      timestamp: 1715000200,
      type: "text",
      text: "before"
    });

    const before = {
      contextToken: await resolveContextToken(stateDir, "bot_m15", "user_m15"),
      syncBuffer: await readSyncBuffer(stateDir, "bot_m15"),
      seenIds: await readSeenIds(stateDir, "bot_m15"),
      history: await readMessageHistory(stateDir, "bot_m15")
    };

    const result = await callMcpTool("analyzeMedia", {
      filePath,
      mode: "transcribeAudio"
    }, {
      config: { stateDir },
      multimodalHelper: async () => {
        throw new Error("temporary model outage");
      }
    });
    const payload = parseToolPayload(result);

    assert.equal(payload.ok, true);
    assert.equal(payload.data.analysis.status, "failed");
    assert.equal(await resolveContextToken(stateDir, "bot_m15", "user_m15"), before.contextToken);
    assert.equal(await readSyncBuffer(stateDir, "bot_m15"), before.syncBuffer);
    assert.deepEqual(await readSeenIds(stateDir, "bot_m15"), before.seenIds);
    assert.deepEqual(await readMessageHistory(stateDir, "bot_m15"), before.history);
    assert.equal(result.content[0].text.includes("ctx_m15_secret"), false);
  });
});

test("M15 docs describe optional helper boundaries and validation", async () => {
  const [readme, helperDoc, validationReport, apiReference, changelog] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("docs/m15-multimodal-helper.md", "utf8"),
    readFile("docs/m15-validation-report.md", "utf8"),
    readFile("skills/wechat-bridge/references/api.md", "utf8"),
    readFile("CHANGELOG.md", "utf8")
  ]);

  for (const content of [readme, helperDoc, validationReport, apiReference]) {
    assert.match(content, /analyzeMedia/);
    assert.match(content, /MULTIMODAL_HELPER_UNAVAILABLE/);
  }

  assert.match(helperDoc, /No optional multimodal helper is configured/);
  assert.match(validationReport, /不需要模型 API key/);
  assert.match(apiReference, /does not modify cursor/);
  assert.match(changelog, /analyzeMedia/);
  assert.match(changelog, /M15 optional/);
});
