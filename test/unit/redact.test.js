import assert from "node:assert/strict";
import test from "node:test";
import { redactSensitiveData, redactText } from "../../src/core/redact.js";

test("redacts nested protocol secrets without mutating the source", () => {
  const source = {
    status: "confirmed",
    qrcode: "short_lived_qrcode_poll_token",
    bot_token: "bot_secret",
    credentials: {
      token: "account_secret",
      contextToken: "ctx_secret",
      media: [
        {
          aeskey: "00112233445566778899aabbccddeeff",
          file_id: "image_file_001"
        }
      ]
    }
  };

  const redacted = redactSensitiveData(source);

  assert.equal(redacted.qrcode, "short_lived_qrcode_poll_token");
  assert.equal(redacted.bot_token, "[REDACTED]");
  assert.equal(redacted.credentials.token, "[REDACTED]");
  assert.equal(redacted.credentials.contextToken, "[REDACTED]");
  assert.equal(redacted.credentials.media[0].aeskey, "[REDACTED]");
  assert.equal(redacted.credentials.media[0].file_id, "image_file_001");
  assert.equal(source.bot_token, "bot_secret");
});

test("redacts bearer tokens in strings", () => {
  assert.equal(
    redactText("Authorization: Bearer abc.def.ghi"),
    "Authorization: Bearer [REDACTED]"
  );
  assert.equal(
    redactText("request failed for Bearer token_secret_123"),
    "request failed for Bearer [REDACTED]"
  );
  assert.equal(
    redactText("WX_BOT_TOKEN=secret-token bot_token=secret-token context_token: ctx-secret"),
    "WX_BOT_TOKEN=[REDACTED] bot_token=[REDACTED] context_token: [REDACTED]"
  );
});

test("redacts error objects for CLI JSON output", () => {
  const error = new Error("Authorization: Bearer secret-token failed");
  error.code = "AUTH_FAILED";
  error.details = {
    context_token: "ctx_secret",
    nested: {
      Authorization: "Bearer other_secret"
    }
  };

  const redacted = redactSensitiveData(error);

  assert.equal(redacted.message, "Authorization: Bearer [REDACTED] failed");
  assert.equal(redacted.code, "AUTH_FAILED");
  assert.equal(redacted.details.context_token, "[REDACTED]");
  assert.equal(redacted.details.nested.Authorization, "[REDACTED]");
});
