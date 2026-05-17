import assert from "node:assert/strict";
import test from "node:test";
import { chunkText } from "../../src/core/chunk-text.js";

test("chunkText keeps short text as one chunk", () => {
  assert.deepEqual(chunkText("hello", { maxChunkChars: 10 }), ["hello"]);
});

test("chunkText prefers sentence boundaries and preserves content", () => {
  const text = "Hello world. Next sentence! Last bit";
  const chunks = chunkText(text, {
    maxChunkChars: 20,
    minChunkChars: 5,
    maxMessages: 10
  });

  assert.deepEqual(chunks, ["Hello world.", " Next sentence!", " Last bit"]);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 20));
});

test("chunkText uses comma and semicolon boundaries before hard splitting", () => {
  const text = "aaaa,bbbb;ccccdddd";
  const chunks = chunkText(text, {
    maxChunkChars: 10,
    minChunkChars: 4,
    maxMessages: 10
  });

  assert.deepEqual(chunks, ["aaaa,bbbb;", "ccccdddd"]);
  assert.equal(chunks.join(""), text);
});

test("chunkText hard splits when no punctuation is available", () => {
  const text = "abcdefghijklmnop";
  const chunks = chunkText(text, {
    maxChunkChars: 5,
    minChunkChars: 2,
    maxMessages: 10
  });

  assert.deepEqual(chunks, ["abcde", "fghij", "klmno", "p"]);
  assert.equal(chunks.join(""), text);
});

test("chunkText rejects text that would exceed the maximum message count", () => {
  assert.throws(
    () => chunkText("abcdefghijklmnop", {
      maxChunkChars: 3,
      minChunkChars: 1,
      maxMessages: 2
    }),
    (error) => {
      assert.equal(error.code, "TEXT_TOO_LONG");
      assert.equal(error.details.maxMessages, 2);
      assert.match(error.details.suggestion, /Shorten the text/);
      return true;
    }
  );
});
