import { protocolErrorCodes } from "./protocol-constants.js";
import { redactSensitiveData } from "./redact.js";

export class WxbError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "WxbError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.status = options.status;
    this.details = options.details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.status ? { status: this.status } : {}),
      ...(this.details ? { details: this.details } : {})
    };
  }
}

export function mapProtocolError({ status = 200, body = {}, cause } = {}) {
  const rawCode = body?.errcode ?? body?.ret ?? body?.error_code;
  const numericCode = rawCode !== undefined && rawCode !== null && rawCode !== "" && Number.isFinite(Number(rawCode))
    ? Number(rawCode)
    : rawCode;

  if (numericCode === protocolErrorCodes.sessionExpired) {
    return new WxbError("SESSION_EXPIRED", "iLink session expired; scan login is required.", {
      retryable: false,
      status,
      details: { protocolCode: numericCode }
    });
  }

  if (numericCode === protocolErrorCodes.invalidArgument) {
    return new WxbError("INVALID_CONTEXT_TOKEN", "iLink rejected the request arguments, often because context_token is invalid.", {
      retryable: false,
      status,
      details: { protocolCode: numericCode }
    });
  }

  if (status === 401 || status === 403) {
    return new WxbError("AUTH_FAILED", "iLink authentication failed.", {
      retryable: false,
      status
    });
  }

  if (status >= 500) {
    return new WxbError("SERVER_ERROR", "iLink server returned an error.", {
      retryable: true,
      status
    });
  }

  if (status >= 400) {
    return new WxbError("HTTP_ERROR", "iLink request failed.", {
      retryable: false,
      status
    });
  }

  if (numericCode !== undefined && numericCode !== null && numericCode !== 0) {
    return new WxbError("PROTOCOL_ERROR", "iLink returned an unsuccessful protocol response.", {
      retryable: false,
      status,
      details: {
        protocolCode: numericCode,
        ...(body?.errmsg ? { errmsg: body.errmsg } : {}),
        ...(body?.error ? { error: body.error } : {})
      }
    });
  }

  if (cause) {
    return new WxbError("NETWORK_ERROR", "Network request failed.", {
      retryable: true,
      details: { cause: cause.message ?? String(cause) }
    });
  }

  return null;
}

export function ok(data = {}) {
  return { ok: true, data };
}

export function fail(error) {
  const normalized = error instanceof WxbError
    ? error
    : new WxbError("UNKNOWN_ERROR", error?.message ?? String(error), { retryable: false });

  return {
    ok: false,
    error: redactSensitiveData(normalized.toJSON())
  };
}

export function cliSuccess(data = {}, meta = undefined) {
  return {
    ok: true,
    data,
    ...(meta ? { meta } : {})
  };
}

export function cliFailure(error) {
  return fail(error);
}
