import { cliFailure, cliSuccess, WxbError } from "../core/errors.js";
import { fetchMessages } from "../core/fetch-messages.js";
import { getAccountStatuses } from "../core/auth.js";
import { listUsers } from "../core/list-users.js";
import { analyzeMedia as analyzeMediaCore } from "../core/media-helper.js";
import { redactSensitiveData } from "../core/redact.js";
import { sendMedia } from "../core/send-media.js";
import { sendText } from "../core/send-text.js";

export const MCP_SERVER_NAME = "wxb-mcp";
export const MCP_PROTOCOL_VERSION = "2024-11-05";

const forbiddenArgumentNames = new Set([
  "contexttoken",
  "context_token",
  "bottoken",
  "bot_token",
  "aeskey",
  "aes_key",
  "uploadurl",
  "upload_url",
  "cdnurl",
  "cdn_url",
  "apikey",
  "api_key",
  "openaiapikey",
  "openai_api_key",
  "modelapikey",
  "model_api_key",
  "providerapikey",
  "provider_api_key"
]);

function textContent(payload) {
  return {
    type: "text",
    text: JSON.stringify(payload, null, 2)
  };
}

function okToolResult(data) {
  return {
    content: [textContent(cliSuccess(data))]
  };
}

function errorToolResult(error) {
  return {
    content: [textContent(cliFailure(error))],
    isError: true
  };
}

function normalizeArgumentName(name) {
  return String(name).replace(/[-_\s]/g, "").toLowerCase();
}

function assertNoSecretArguments(args = {}) {
  const stack = [{ value: args, path: [] }];

  while (stack.length > 0) {
    const { value, path } = stack.pop();
    if (!value || typeof value !== "object") {
      continue;
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        stack.push({ value: value[index], path: [...path, String(index)] });
      }
      continue;
    }

    for (const [name, entryValue] of Object.entries(value)) {
      const normalized = normalizeArgumentName(name);
      if (forbiddenArgumentNames.has(normalized)) {
        throw new WxbError("MCP_SECRET_ARGUMENT_UNSUPPORTED", "MCP tools do not accept bridge-managed secret arguments.", {
          retryable: false,
          details: { argument: [...path, name].join(".") }
        });
      }
      stack.push({ value: entryValue, path: [...path, name] });
    }
  }
}

function negotiateProtocolVersion(requestedVersion) {
  return requestedVersion === MCP_PROTOCOL_VERSION
    ? requestedVersion
    : MCP_PROTOCOL_VERSION;
}

function requireConfig(context = {}) {
  if (!context.config?.stateDir) {
    throw new TypeError("config.stateDir is required");
  }
  return context.config;
}

function optionalString(args, key) {
  const value = args?.[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WxbError("MCP_ARGUMENT_INVALID", `${key} must be a string.`, {
      retryable: false,
      details: { key, valueType: typeof value }
    });
  }
  return value;
}

function requiredString(args, key) {
  const value = optionalString(args, key);
  if (!value) {
    throw new WxbError("MCP_ARGUMENT_REQUIRED", `${key} is required.`, {
      retryable: false,
      details: { key }
    });
  }
  return value;
}

function optionalNumber(args, key, options = {}) {
  const value = args?.[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new WxbError("MCP_ARGUMENT_INVALID", `${key} must be a finite number.`, {
      retryable: false,
      details: { key, value }
    });
  }

  if (options.integer && !Number.isInteger(numberValue)) {
    throw new WxbError("MCP_ARGUMENT_INVALID", `${key} must be an integer.`, {
      retryable: false,
      details: { key, value: numberValue }
    });
  }

  if (options.min !== undefined && numberValue < options.min) {
    throw new WxbError("MCP_ARGUMENT_INVALID", `${key} must be greater than or equal to ${options.min}.`, {
      retryable: false,
      details: { key, value: numberValue, min: options.min }
    });
  }

  return numberValue;
}

function optionalBoolean(args, key, defaultValue = false) {
  const value = args?.[key];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new WxbError("MCP_ARGUMENT_INVALID", `${key} must be a boolean.`, {
      retryable: false,
      details: { key, valueType: typeof value }
    });
  }
  return value;
}

function optionalAccountId(args) {
  return optionalString(args, "accountId");
}

function baseOperationOptions(args, context) {
  return {
    stateDir: requireConfig(context).stateDir,
    accountId: optionalAccountId(args),
    config: requireConfig(context)
  };
}

const accountIdProperty = Object.freeze({
  type: "string",
  description: "Optional saved iLink account id. Omit when exactly one account is configured."
});

export const mcpTools = Object.freeze([
  {
    name: "fetchMessages",
    description: "Fetch one batch of inbound WeChat messages through the local bridge. Media can be downloaded to local attachment paths.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        accountId: accountIdProperty,
        timeoutMs: {
          type: "number",
          minimum: 1,
          description: "Local request timeout in milliseconds."
        },
        maxAttempts: {
          type: "integer",
          minimum: 1,
          description: "Maximum retry attempts for transient fetch failures."
        },
        downloadMedia: {
          type: "boolean",
          description: "When true, save media attachments locally and return attachments[].path."
        }
      }
    }
  },
  {
    name: "sendText",
    description: "Send a text reply to a previously seen WeChat user through cached bridge routing state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        accountId: accountIdProperty,
        userId: {
          type: "string",
          description: "Opaque fromUserId returned by fetchMessages."
        },
        alias: {
          type: "string",
          description: "Optional local alias for a previously seen user."
        },
        text: {
          type: "string",
          minLength: 1,
          description: "Text to deliver."
        },
        typing: {
          type: "boolean",
          description: "Show typing state while sending."
        },
        timeoutMs: {
          type: "number",
          minimum: 1,
          description: "Local request timeout in milliseconds."
        },
        queueOnNoContext: {
          type: "boolean",
          description: "Queue the text when the target user has no cached route yet."
        },
        queueOnInvalidContext: {
          type: "boolean",
          description: "Queue the text when the route is stale before any chunk is delivered. Defaults to true."
        }
      },
      required: ["text"]
    }
  },
  {
    name: "sendFile",
    description: "Send a local file or image path to a previously seen WeChat user. Upload credentials stay inside the bridge.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        accountId: accountIdProperty,
        userId: {
          type: "string",
          description: "Opaque fromUserId returned by fetchMessages."
        },
        alias: {
          type: "string",
          description: "Optional local alias for a previously seen user."
        },
        filePath: {
          type: "string",
          minLength: 1,
          description: "Absolute or relative local filesystem path to send."
        },
        kind: {
          type: "string",
          enum: ["file", "image"],
          description: "Send mode. Use image only for image MIME types."
        },
        typing: {
          type: "boolean",
          description: "Show typing state while sending."
        },
        timeoutMs: {
          type: "number",
          minimum: 1,
          description: "Local request timeout in milliseconds."
        }
      },
      required: ["filePath"]
    }
  },
  {
    name: "listUsers",
    description: "List locally known WeChat users that have appeared in bridge state, including aliases and reply readiness.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        accountId: accountIdProperty
      }
    }
  },
  {
    name: "status",
    description: "Return local bridge account, cursor, conversation, and history status without calling the remote iLink API.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        accountId: accountIdProperty
      }
    }
  },
  {
    name: "analyzeMedia",
    description: "Inspect a local media path and optionally delegate image, audio, video, or text understanding to a host-provided helper.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        filePath: {
          type: "string",
          minLength: 1,
          description: "Local filesystem path returned by attachments[].path or otherwise provided by the user."
        },
        mode: {
          type: "string",
          enum: ["inspect", "extractText", "imageQuestion", "transcribeAudio", "summarizeVideo"],
          description: "Optional analysis mode. Defaults to inspect."
        },
        question: {
          type: "string",
          description: "Optional question or instruction for a host-provided multimodal helper."
        },
        maxTextBytes: {
          type: "integer",
          minimum: 0,
          description: "Maximum bytes to read for local text preview or extraction."
        }
      },
      required: ["filePath"]
    }
  }
]);

const toolHandlers = Object.freeze({
  async fetchMessages(args = {}, context = {}) {
    const config = requireConfig(context);
    return fetchMessages({
      ...baseOperationOptions(args, context),
      timeoutMs: optionalNumber(args, "timeoutMs", { min: 1 }) ?? config.fetchTimeoutMs,
      retry: {
        maxAttempts: optionalNumber(args, "maxAttempts", { integer: true, min: 1 }) ?? 3,
        retryDelaysMs: context.retryDelaysMs
      },
      downloadMedia: optionalBoolean(args, "downloadMedia", false),
      mediaFetchImpl: context.mediaFetchImpl
    });
  },

  async sendText(args = {}, context = {}) {
    const config = requireConfig(context);
    return sendText({
      ...baseOperationOptions(args, context),
      userId: optionalString(args, "userId"),
      alias: optionalString(args, "alias"),
      text: requiredString(args, "text"),
      timeoutMs: optionalNumber(args, "timeoutMs", { min: 1 }) ?? config.fetchTimeoutMs,
      client: context.client,
      queueOnInvalidContext: optionalBoolean(args, "queueOnInvalidContext", true),
      queueOnNoContext: optionalBoolean(args, "queueOnNoContext", false),
      typing: optionalBoolean(args, "typing", false)
    });
  },

  async sendFile(args = {}, context = {}) {
    const config = requireConfig(context);
    return sendMedia({
      ...baseOperationOptions(args, context),
      userId: optionalString(args, "userId"),
      alias: optionalString(args, "alias"),
      filePath: requiredString(args, "filePath"),
      kind: optionalString(args, "kind") ?? "file",
      timeoutMs: optionalNumber(args, "timeoutMs", { min: 1 }) ?? config.fetchTimeoutMs,
      client: context.client,
      typing: optionalBoolean(args, "typing", false)
    });
  },

  async listUsers(args = {}, context = {}) {
    return listUsers(requireConfig(context).stateDir, {
      accountId: optionalAccountId(args)
    });
  },

  async status(args = {}, context = {}) {
    const accounts = await getAccountStatuses(requireConfig(context).stateDir, {
      accountId: optionalAccountId(args)
    });

    return {
      accounts,
      count: accounts.length
    };
  },

  async analyzeMedia(args = {}, context = {}) {
    return analyzeMediaCore({
      filePath: requiredString(args, "filePath"),
      mode: optionalString(args, "mode") ?? "inspect",
      question: optionalString(args, "question"),
      maxTextBytes: optionalNumber(args, "maxTextBytes", { integer: true, min: 0 }),
      helper: context.multimodalHelper
    });
  }
});

export function listMcpTools() {
  return mcpTools.map((tool) => ({ ...tool }));
}

export async function callMcpTool(name, args = {}, context = {}) {
  const handler = toolHandlers[name];
  if (!handler) {
    return errorToolResult(new WxbError("MCP_TOOL_NOT_FOUND", `Unknown MCP tool: ${name}`, {
      retryable: false,
      details: { name }
    }));
  }

  try {
    assertNoSecretArguments(args);
    const data = await handler(args, context);
    return okToolResult(data);
  } catch (error) {
    return errorToolResult(error);
  }
}

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data ? { data: redactSensitiveData(data) } : {})
    }
  };
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function requestId(request) {
  return Object.hasOwn(request ?? {}, "id") ? request.id : null;
}

export async function handleMcpRequest(request, context = {}) {
  if (!request || request.jsonrpc !== "2.0" || !request.method) {
    return jsonRpcError(requestId(request), -32600, "Invalid JSON-RPC request.");
  }

  if (!Object.hasOwn(request, "id")) {
    return undefined;
  }

  try {
    if (request.method === "initialize") {
      return jsonRpcResult(request.id, {
        protocolVersion: negotiateProtocolVersion(request.params?.protocolVersion),
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: context.version ?? "0.2.0"
        }
      });
    }

    if (request.method === "ping") {
      return jsonRpcResult(request.id, {});
    }

    if (request.method === "tools/list") {
      return jsonRpcResult(request.id, {
        tools: listMcpTools()
      });
    }

    if (request.method === "tools/call") {
      const name = request.params?.name;
      if (!name || typeof name !== "string") {
        return jsonRpcError(request.id, -32602, "tools/call requires params.name.");
      }

      return jsonRpcResult(request.id, await callMcpTool(name, request.params?.arguments ?? {}, context));
    }

    return jsonRpcError(request.id, -32601, `Method not found: ${request.method}`);
  } catch (error) {
    return jsonRpcError(request.id, -32603, "Internal MCP adapter error.", cliFailure(error));
  }
}
