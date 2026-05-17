import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeRawMessage,
  normalizeUpdateResponse
} from "../../src/core/message-normalizer.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function readFixture(name) {
  const fullPath = path.join(rootDir, "test", "fixtures", "raw", name);
  return JSON.parse(await readFile(fullPath, "utf8"));
}

test("normalizes text getupdates fixture without exposing context_token", async () => {
  const raw = await readFixture("getupdates-text-message.json");
  const normalized = normalizeUpdateResponse(raw);

  assert.equal(normalized.ret, 0);
  assert.equal(normalized.getUpdatesBuf, "cursor_002");
  assert.equal(normalized.messages.length, 1);

  const [message] = normalized.messages;
  assert.equal(message.id, "msg_text_001");
  assert.equal(message.type, "text");
  assert.equal(message.text, "hello from fixture");
  assert.equal(message.fromUserId, "user_opaque_001");
  assert.equal(message.timestamp, 1715000000);
  assert.equal(message.hasContextToken, true);
  assert.equal(Object.hasOwn(message, "contextToken"), false);
});

test("can include context token only for internal callers", async () => {
  const raw = await readFixture("getupdates-text-message.json");
  const message = normalizeRawMessage(raw.msgs[0], { includeContextToken: true });

  assert.equal(message.contextToken, "ctx_text_001_should_not_escape");
});

test("normalizes mixed text and image fixture", async () => {
  const raw = await readFixture("getupdates-mixed-text-image.json");
  const normalized = normalizeUpdateResponse(raw);
  const [message] = normalized.messages;

  assert.equal(message.id, "msg_mixed_001");
  assert.equal(message.type, "mixed");
  assert.equal(message.text, "image caption");
  assert.equal(message.timestamp, 1715000100);
  assert.deepEqual(message.items.map((item) => item.kind), ["text", "image"]);

  const image = message.items[1];
  assert.equal(image.metadata.fileId, "image_file_001");
  assert.equal(image.metadata.fileName, "sample-image.jpg");
  assert.equal(image.metadata.mimeType, "image/jpeg");
  assert.equal(Object.hasOwn(image.metadata, "aesKey"), false);
});

test("normalizes nested media fields from real iLink image items", () => {
  const raw = {
    ret: 0,
    get_updates_buf: "cursor_nested_media",
    msgs: [
      {
        msg_id: "msg_nested_image",
        from_user_id: "user_nested_media",
        context_token: "ctx_nested_media_secret",
        timestamp: 1778988481,
        item_list: [
          {
            type: 3,
            image_item: {
              file_name: "wechat-image.jpg",
              mime_type: "image/jpeg",
              width: 640,
              height: 480,
              media: {
                encrypt_query_param: "token=abc&fileid=image_nested",
                aes_key: "00112233445566778899aabbccddeeff",
                full_url: "/c2c/download?token=abc&fileid=image_nested"
              },
              thumb_media: {
                encrypt_query_param: "token=thumb&fileid=thumb_nested"
              }
            }
          }
        ]
      }
    ]
  };

  const publicNormalized = normalizeUpdateResponse(raw);
  const publicImage = publicNormalized.messages[0].items[0];
  assert.equal(publicImage.metadata.fileName, "wechat-image.jpg");
  assert.equal(Object.hasOwn(publicImage.metadata, "url"), false);
  assert.equal(Object.hasOwn(publicImage.metadata, "encryptQueryParam"), false);
  assert.equal(Object.hasOwn(publicImage.metadata, "thumbEncryptQueryParam"), false);
  assert.equal(Object.hasOwn(publicImage.metadata, "aesKey"), false);

  const internalNormalized = normalizeUpdateResponse(raw, {
    includeContextToken: true,
    includeMediaSecrets: true
  });
  const internalImage = internalNormalized.messages[0].items[0];
  assert.equal(internalNormalized.messages[0].contextToken, "ctx_nested_media_secret");
  assert.equal(internalImage.metadata.url, "/c2c/download?token=abc&fileid=image_nested");
  assert.equal(internalImage.metadata.encryptQueryParam, "token=abc&fileid=image_nested");
  assert.equal(internalImage.metadata.thumbEncryptQueryParam, "token=thumb&fileid=thumb_nested");
  assert.equal(internalImage.metadata.aesKey, "00112233445566778899aabbccddeeff");
});

test("keeps non-text voice metadata instead of throwing", async () => {
  const raw = await readFixture("getupdates-voice-message.json");
  const normalized = normalizeUpdateResponse(raw);
  const [message] = normalized.messages;

  assert.equal(message.type, "voice");
  assert.equal(message.items[0].metadata.fileId, "voice_file_001");
  assert.equal(message.items[0].metadata.duration, 3200);
});

test("handles empty long-poll timeout response", async () => {
  const raw = await readFixture("getupdates-empty-timeout.json");
  const normalized = normalizeUpdateResponse(raw);

  assert.equal(normalized.ret, 0);
  assert.equal(normalized.getUpdatesBuf, "cursor_001");
  assert.deepEqual(normalized.messages, []);
});
