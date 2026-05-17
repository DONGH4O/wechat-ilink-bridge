import assert from "node:assert/strict";
import test from "node:test";
import { fail, mapProtocolError, WxbError } from "../../src/core/errors.js";

test("maps -14 to SESSION_EXPIRED", () => {
  const error = mapProtocolError({ body: { errcode: -14 } });

  assert.equal(error.code, "SESSION_EXPIRED");
  assert.equal(error.retryable, false);
});

test("maps -2 to INVALID_CONTEXT_TOKEN", () => {
  const error = mapProtocolError({ body: { ret: -2 } });

  assert.equal(error.code, "INVALID_CONTEXT_TOKEN");
  assert.equal(error.retryable, false);
});

test("maps HTTP server errors as retryable", () => {
  const error = mapProtocolError({ status: 502, body: { ret: 1 } });

  assert.equal(error.code, "SERVER_ERROR");
  assert.equal(error.retryable, true);
});

test("returns null for successful protocol response", () => {
  assert.equal(mapProtocolError({ status: 200, body: { ret: 0 } }), null);
});

test("treats string zero protocol codes as successful", () => {
  assert.equal(mapProtocolError({ status: 200, body: { ret: "0" } }), null);
});

test("formats CLI failures without leaking secrets", () => {
  const response = fail(new WxbError("AUTH_FAILED", "Authorization: Bearer secret failed", {
    details: { token: "secret" }
  }));

  assert.equal(response.ok, false);
  assert.equal(response.error.message, "Authorization: Bearer [REDACTED] failed");
  assert.equal(response.error.details.token, "[REDACTED]");
});
