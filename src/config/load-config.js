import { readFile } from "node:fs/promises";
import path from "node:path";
import { WxbError } from "../core/errors.js";
import { protocolDefaults } from "../core/protocol-constants.js";
import { resolveStateDir } from "../state/state-dir.js";

const envKeyByConfigKey = Object.freeze({
  baseUrl: "WX_BASE_URL",
  cdnBaseUrl: "WX_CDN_BASE_URL",
  qrBotType: "WX_QR_BOT_TYPE",
  channelVersion: "WX_CHANNEL_VERSION",
  stateDir: "WX_STATE_DIR",
  fetchTimeoutMs: "WX_FETCH_TIMEOUT_MS",
  pollIntervalMs: "WX_POLL_INTERVAL_MS",
  loginPollTimeoutMs: "WX_LOGIN_POLL_TIMEOUT_MS",
  minChunkChars: "WX_MIN_CHUNK_CHARS",
  maxChunkChars: "WX_MAX_CHUNK_CHARS",
  maxDeliveryMessages: "WX_MAX_DELIVERY_MESSAGES",
  delayedQueueMaxItems: "WX_DELAYED_QUEUE_MAX_ITEMS",
  messageRetentionDays: "WX_MESSAGE_RETENTION_DAYS",
  attachmentRetentionDays: "WX_ATTACHMENT_RETENTION_DAYS",
  maxHistoryMessages: "WX_MAX_HISTORY_MESSAGES",
  maxUploadBytes: "WX_MAX_UPLOAD_BYTES",
  botUserName: "BOT_USER_NAME"
});

const numberKeys = new Set([
  "qrBotType",
  "fetchTimeoutMs",
  "pollIntervalMs",
  "loginPollTimeoutMs",
  "minChunkChars",
  "maxChunkChars",
  "maxDeliveryMessages",
  "delayedQueueMaxItems",
  "messageRetentionDays",
  "attachmentRetentionDays",
  "maxHistoryMessages",
  "maxUploadBytes"
]);

function kebabToCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function parseDotEnv(content = "") {
  const result = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }

  return result;
}

export function parseCliArgs(argv = []) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry?.startsWith("--")) {
      continue;
    }

    const withoutPrefix = entry.slice(2);
    const separatorIndex = withoutPrefix.indexOf("=");
    const rawKey = separatorIndex >= 0
      ? withoutPrefix.slice(0, separatorIndex)
      : withoutPrefix;
    const inlineValue = separatorIndex >= 0
      ? withoutPrefix.slice(separatorIndex + 1)
      : undefined;
    const key = kebabToCamel(rawKey);
    const next = argv[index + 1];

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}

function valueFromEnv(env, key) {
  const envKey = envKeyByConfigKey[key];
  return envKey ? env[envKey] : undefined;
}

function coerceValue(key, value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === true) {
    throw new WxbError("CONFIG_VALUE_MISSING", `Configuration option requires a value: ${key}`, {
      retryable: false,
      details: { key }
    });
  }

  if (numberKeys.has(key)) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      throw new WxbError("CONFIG_VALUE_INVALID", `${key} must be a finite number`, {
        retryable: false,
        details: { key, value }
      });
    }
    return numberValue;
  }

  return value;
}

async function readEnvFile(cwd, envFilePath) {
  const filePath = envFilePath ?? path.join(cwd, ".env");
  try {
    return parseDotEnv(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function loadConfig(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const cli = {
    ...parseCliArgs(options.argv ?? []),
    ...(options.cli ?? {})
  };
  const envFile = options.envFile ?? await readEnvFile(cwd, options.envFilePath);
  const defaults = {
    ...protocolDefaults,
    stateDir: undefined,
    botUserName: undefined
  };
  const config = {};

  for (const key of Object.keys(envKeyByConfigKey)) {
    const raw = cli[key] ?? valueFromEnv(env, key) ?? valueFromEnv(envFile, key) ?? defaults[key];
    const coerced = coerceValue(key, raw);
    if (coerced !== undefined) {
      config[key] = coerced;
    }
  }

  config.stateDir = resolveStateDir({
    stateDir: config.stateDir,
    env,
    platform: options.platform,
    homeDir: options.homeDir,
    cwd
  });

  return config;
}
