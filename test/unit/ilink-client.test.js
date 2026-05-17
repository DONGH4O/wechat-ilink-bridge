import assert from "node:assert/strict";
import test from "node:test";
import { IlinkClient } from "../../src/core/ilink-client.js";

function jsonResponse(status, body) {
  return {
    status,
    text: async () => JSON.stringify(body)
  };
}

function textResponse(status, body) {
  return {
    status,
    text: async () => body
  };
}

test("maps non-JSON HTTP 5xx responses as server errors", async () => {
  const client = new IlinkClient({
    fetchImpl: async () => textResponse(502, "<html>bad gateway</html>")
  });

  await assert.rejects(
    client.getUpdates({ token: "token_fixture" }),
    (error) => {
      assert.equal(error.name, "WxbError");
      assert.equal(error.code, "SERVER_ERROR");
      assert.equal(error.status, 502);
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test("maps unknown non-zero protocol codes as protocol errors", async () => {
  const client = new IlinkClient({
    fetchImpl: async () => jsonResponse(200, { ret: 123, errmsg: "fixture failure" })
  });

  await assert.rejects(
    client.getUpdates({ token: "token_fixture" }),
    (error) => {
      assert.equal(error.name, "WxbError");
      assert.equal(error.code, "PROTOCOL_ERROR");
      assert.equal(error.details.protocolCode, 123);
      assert.equal(error.details.errmsg, "fixture failure");
      return true;
    }
  );
});

test("maps successful non-JSON responses as invalid responses", async () => {
  const client = new IlinkClient({
    fetchImpl: async () => textResponse(200, "not json")
  });

  await assert.rejects(
    client.getBotQrcode(),
    (error) => {
      assert.equal(error.name, "WxbError");
      assert.equal(error.code, "INVALID_RESPONSE");
      assert.equal(error.status, 200);
      return true;
    }
  );
});
