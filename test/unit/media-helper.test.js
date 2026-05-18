import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeMedia, inspectMediaFile } from "../../src/core/media-helper.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/azfN0cAAAAASUVORK5CYII=",
  "base64"
);

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb media helper "));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("inspectMediaFile returns safe local metadata for image files", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "pixel.png");
    await writeFile(filePath, onePixelPng);

    const media = await inspectMediaFile(filePath);

    assert.equal(media.path, path.resolve(filePath));
    assert.equal(media.fileName, "pixel.png");
    assert.equal(media.mimeType, "image/png");
    assert.equal(media.kind, "image");
    assert.equal(media.bytes, onePixelPng.length);
    assert.deepEqual(media.dimensions, { width: 1, height: 1 });
    assert.equal(media.sha256, createHash("sha256").update(onePixelPng).digest("hex"));
    assert.equal("textPreview" in media, false);
  });
});

test("analyzeMedia extracts local text previews without model dependencies", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "note.txt");
    await writeFile(filePath, "hello token=secret_value world", "utf8");

    const result = await analyzeMedia({
      filePath,
      mode: "extractText",
      maxTextBytes: 12
    });

    assert.equal(result.analysis.status, "completed");
    assert.equal(result.analysis.provider, "local-text-preview");
    assert.equal(result.analysis.text, "hello token=");
    assert.equal(result.analysis.truncated, true);
    assert.equal(result.media.kind, "text");
  });
});

test("analyzeMedia degrades when no optional model helper is configured", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "pixel.png");
    await writeFile(filePath, onePixelPng);

    const result = await analyzeMedia({
      filePath,
      mode: "imageQuestion",
      question: "what is in this image?"
    });

    assert.equal(result.analysis.status, "unavailable");
    assert.equal(result.analysis.code, "MULTIMODAL_HELPER_UNAVAILABLE");
    assert.match(result.analysis.suggestedAction, /Agent vision model/);
    assert.equal(result.media.mimeType, "image/png");
  });
});

test("analyzeMedia calls optional helpers and fail-softs helper errors", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "audio.mp3");
    await writeFile(filePath, Buffer.from("ID3fixture"));
    const helperCalls = [];

    const completed = await analyzeMedia({
      filePath,
      mode: "transcribeAudio",
      helper: async (request) => {
        helperCalls.push(request);
        return {
          provider: "fixture",
          result: {
            transcript: "hello",
            apiKey: "should_not_escape",
            openaiApiKey: "openai_key_should_not_escape",
            clientSecret: "client_secret_should_not_escape",
            nested: {
              providerSecret: "provider_secret_should_not_escape"
            },
            notes: "openaiApiKey=text_secret_should_not_escape"
          }
        };
      }
    });

    assert.equal(helperCalls.length, 1);
    assert.equal(helperCalls[0].media.kind, "audio");
    assert.equal(completed.analysis.status, "completed");
    assert.equal(completed.analysis.provider, "fixture");
    assert.equal(completed.analysis.result.transcript, "hello");
    assert.equal(completed.analysis.result.apiKey, "[REDACTED]");
    assert.equal(completed.analysis.result.openaiApiKey, "[REDACTED]");
    assert.equal(completed.analysis.result.clientSecret, "[REDACTED]");
    assert.equal(completed.analysis.result.nested.providerSecret, "[REDACTED]");
    assert.equal(completed.analysis.result.notes.includes("text_secret_should_not_escape"), false);
    assert.equal(JSON.stringify(completed).includes("should_not_escape"), false);

    const failed = await analyzeMedia({
      filePath,
      mode: "transcribeAudio",
      helper: async () => {
        throw new Error("provider token=secret failed");
      }
    });

    assert.equal(failed.analysis.status, "failed");
    assert.equal(failed.analysis.code, "MULTIMODAL_HELPER_FAILED");
    assert.equal(failed.analysis.message.includes("secret"), false);
    assert.match(failed.analysis.fallback, /state was not modified/);
  });
});
