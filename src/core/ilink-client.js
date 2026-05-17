import { randomBytes, randomInt } from "node:crypto";
import {
  authHeaders,
  endpoints,
  protocolDefaults
} from "./protocol-constants.js";
import { WxbError, mapProtocolError } from "./errors.js";

function joinUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export function makeWechatUin() {
  const value = randomInt(1, 0xffffffff);
  return Buffer.from(String(value)).toString("base64");
}

export function generateClientId(now = Date.now()) {
  return `wxb-${now}-${randomBytes(4).toString("hex")}`;
}

export class IlinkClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? protocolDefaults.baseUrl;
    this.channelVersion = options.channelVersion ?? protocolDefaults.channelVersion;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async getBotQrcode(options = {}) {
    const botType = options.botType ?? protocolDefaults.qrBotType;
    return this.getJson(endpoints.getBotQrcode, { bot_type: botType }, options);
  }

  async getQrcodeStatus(qrcode, options = {}) {
    return this.getJson(endpoints.getQrcodeStatus, { qrcode }, options);
  }

  async getUpdates({ token, getUpdatesBuf = "", timeoutMs } = {}) {
    return this.postJson(endpoints.getUpdates, {
      get_updates_buf: getUpdatesBuf,
      base_info: {
        channel_version: this.channelVersion
      }
    }, { token, timeoutMs });
  }

  async sendTextMessage({ token, toUserId, text, contextToken, clientId = generateClientId(), timeoutMs } = {}) {
    return this.sendMessage({
      token,
      timeoutMs,
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [
          {
            type: 1,
            text_item: { text }
          }
        ],
        context_token: contextToken
      }
    });
  }

  async getConfig({ token, userId, contextToken, timeoutMs } = {}) {
    return this.postJson(endpoints.getConfig, {
      ilink_user_id: userId,
      context_token: contextToken,
      base_info: {
        channel_version: this.channelVersion
      }
    }, { token, timeoutMs });
  }

  async sendTyping({ token, userId, typingTicket, status, timeoutMs } = {}) {
    return this.postJson(endpoints.sendTyping, {
      ilink_user_id: userId,
      typing_ticket: typingTicket,
      status,
      base_info: {
        channel_version: this.channelVersion
      }
    }, { token, timeoutMs });
  }

  async getUploadUrl({ token, upload, timeoutMs } = {}) {
    return this.postJson(endpoints.getUploadUrl, {
      ...upload,
      base_info: {
        channel_version: this.channelVersion
      }
    }, { token, timeoutMs });
  }

  async sendMediaMessage({ token, toUserId, item, contextToken, clientId = generateClientId(), timeoutMs } = {}) {
    return this.sendMessage({
      token,
      timeoutMs,
      msg: {
        from_user_id: "",
        to_user_id: toUserId,
        client_id: clientId,
        message_type: 2,
        message_state: 2,
        item_list: [item],
        context_token: contextToken
      }
    });
  }

  async sendMessage({ token, msg, timeoutMs } = {}) {
    return this.postJson(endpoints.sendMessage, {
      msg,
      base_info: {
        channel_version: this.channelVersion
      }
    }, { token, timeoutMs });
  }

  async uploadBytes({ uploadUrl, bytes, contentType = "application/octet-stream", timeoutMs } = {}) {
    if (!uploadUrl) {
      throw new WxbError("MEDIA_UPLOAD_URL_MISSING", "iLink did not return a media upload URL.", {
        retryable: false
      });
    }

    const response = await this.requestRaw(new URL(uploadUrl, this.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": contentType
      },
      body: bytes,
      timeoutMs
    });

    if (response.status >= 400) {
      throw new WxbError("MEDIA_UPLOAD_FAILED", "Media upload failed.", {
        retryable: response.status >= 500,
        status: response.status
      });
    }

    return response;
  }

  async getJson(pathname, query = {}, options = {}) {
    const response = await this.request(joinUrl(this.baseUrl, pathname, query), {
      method: "GET",
      timeoutMs: options.timeoutMs
    });
    return response.body;
  }

  async postJson(pathname, body, options = {}) {
    const response = await this.request(joinUrl(this.baseUrl, pathname), {
      method: "POST",
      token: options.token,
      body,
      timeoutMs: options.timeoutMs
    });
    return response.body;
  }

  async request(url, options = {}) {
    if (!this.fetchImpl) {
      throw new Error("global fetch is unavailable; use Node.js 18+ or pass fetchImpl.");
    }

    const headers = {
      Accept: "application/json",
      ...(options.method === "POST" ? { "Content-Type": "application/json" } : {})
    };

    if (options.token) {
      headers.AuthorizationType = authHeaders.authorizationType;
      headers.Authorization = `Bearer ${options.token}`;
      headers["X-WECHAT-UIN"] = makeWechatUin();
    }

    const controller = options.timeoutMs ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(new Error("request timeout")), options.timeoutMs)
      : undefined;

    try {
      const response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller?.signal
      });

      const responseText = await response.text();
      let parsedBody = {};
      let parseError;

      if (responseText) {
        try {
          parsedBody = JSON.parse(responseText);
        } catch (error) {
          parseError = error;
        }
      }

      const mapped = mapProtocolError({ status: response.status, body: parsedBody });

      if (mapped) {
        throw mapped;
      }

      if (parseError) {
        throw new WxbError("INVALID_RESPONSE", "iLink returned a non-JSON response.", {
          retryable: false,
          status: response.status,
          details: { cause: parseError.message }
        });
      }

      return {
        status: response.status,
        body: parsedBody
      };
    } catch (error) {
      const mapped = mapProtocolError({ cause: error });
      if (mapped && error.name !== "WxbError") {
        throw mapped;
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async requestRaw(url, options = {}) {
    if (!this.fetchImpl) {
      throw new Error("global fetch is unavailable; use Node.js 18+ or pass fetchImpl.");
    }

    const controller = options.timeoutMs ? new AbortController() : undefined;
    const timeout = controller
      ? setTimeout(() => controller.abort(new Error("request timeout")), options.timeoutMs)
      : undefined;

    try {
      const response = await this.fetchImpl(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller?.signal
      });
      const responseText = await response.text();
      let body;

      if (responseText) {
        try {
          body = JSON.parse(responseText);
        } catch {
          body = responseText;
        }
      }

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body
      };
    } catch (error) {
      const mapped = mapProtocolError({ cause: error });
      if (mapped && error.name !== "WxbError") {
        throw mapped;
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
