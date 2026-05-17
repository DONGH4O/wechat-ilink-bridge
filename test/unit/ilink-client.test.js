import assert from "node:assert/strict";
import test from "node:test";
import { IlinkClient } from "../../src/core/ilink-client.js";

function responseHeaders(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    entries: () => Object.entries(normalized)
  };
}

function jsonResponse(status, body, headers) {
  return {
    status,
    headers: responseHeaders(headers),
    text: async () => JSON.stringify(body)
  };
}

function textResponse(status, body) {
  return {
    status,
    headers: responseHeaders(),
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

test("posts upload, typing, and media send payloads with iLink headers", async () => {
  const requests = [];
  const client = new IlinkClient({
    baseUrl: "https://mock.example",
    fetchImpl: async (url, options) => {
      requests.push({
        url: String(url),
        method: options.method,
        headers: options.headers,
        body: options.body
      });
      return jsonResponse(200, { ret: 0, upload_url: "https://upload.example/media", typing_ticket: "ticket" });
    }
  });

  await client.getUploadUrl({
    token: "token_fixture",
    upload: {
      filekey: "filekey_fixture",
      media_type: 1,
      to_user_id: "user_fixture"
    }
  });
  await client.getConfig({
    token: "token_fixture",
    userId: "user_fixture",
    contextToken: "ctx_fixture"
  });
  await client.sendTyping({
    token: "token_fixture",
    userId: "user_fixture",
    typingTicket: "ticket_fixture",
    status: 1
  });
  await client.sendMediaMessage({
    token: "token_fixture",
    toUserId: "user_fixture",
    contextToken: "ctx_fixture",
    clientId: "client_fixture",
    item: {
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: "download_param_fixture",
          aes_key: "YWVzX2ZpeHR1cmU=",
          encrypt_type: 1
        }
      }
    }
  });

  assert.equal(requests[0].url, "https://mock.example/ilink/bot/getuploadurl");
  assert.equal(JSON.parse(requests[0].body).filekey, "filekey_fixture");
  assert.equal(JSON.parse(requests[0].body).base_info.channel_version, "0.1.0");
  assert.equal(JSON.parse(requests[1].body).context_token, "ctx_fixture");
  assert.equal(JSON.parse(requests[2].body).typing_ticket, "ticket_fixture");
  assert.equal(JSON.parse(requests[2].body).status, 1);
  const mediaBody = JSON.parse(requests[3].body);
  assert.equal(mediaBody.msg.client_id, "client_fixture");
  assert.equal(mediaBody.msg.item_list[0].type, 2);
  for (const request of requests) {
    assert.equal(request.headers.Authorization, "Bearer token_fixture");
    assert.equal(request.headers.AuthorizationType, "ilink_bot_token");
    assert.match(request.headers["X-WECHAT-UIN"], /^[A-Za-z0-9+/]+=*$/);
  }
});

test("uploads raw media bytes without bearer headers", async () => {
  const requests = [];
  const bytes = Buffer.from("encrypted bytes");
  const client = new IlinkClient({
    baseUrl: "https://mock.example",
    fetchImpl: async (url, options) => {
      requests.push({
        url: String(url),
        method: options.method,
        headers: options.headers,
        body: options.body
      });
      return jsonResponse(200, { ret: 0 }, { "x-encrypted-param": "download_param_fixture" });
    }
  });

  const response = await client.uploadBytes({
    uploadUrl: "https://upload.example/media",
    bytes,
    contentType: "application/octet-stream"
  });

  assert.equal(requests[0].url, "https://upload.example/media");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(requests[0].headers["Content-Type"], "application/octet-stream");
  assert.equal(requests[0].body, bytes);
  assert.equal(response.headers["x-encrypted-param"], "download_param_fixture");
});
