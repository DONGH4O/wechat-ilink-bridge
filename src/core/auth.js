import { WxbError } from "./errors.js";
import { publicAccountView, listAccounts, saveAccount } from "../state/account-store.js";
import { readContextTokens } from "../state/context-token-store.js";
import { readMessageHistory } from "../state/message-history.js";
import { readSyncBuffer } from "../state/sync-buffer-store.js";
import { withAccountLock } from "../state/lock.js";

const pendingQrStatuses = new Set(["wait", "scaned", "scanned"]);
const canceledQrStatuses = new Set(["cancel", "canceled", "cancelled"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeQrcodeResponse(raw = {}) {
  const qrcode = raw.qrcode ?? raw.qr_code ?? raw.token;
  const imageUrl = raw.qrcode_img_url ?? raw.qrcode_img_content ?? raw.url;

  if (!qrcode) {
    throw new WxbError("LOGIN_QRCODE_INVALID", "iLink QR code response is missing qrcode.", {
      retryable: false,
      details: { fields: Object.keys(raw) }
    });
  }

  return {
    qrcode,
    imageUrl,
    imageContent: raw.qrcode_img_content,
    raw
  };
}

export function normalizeConfirmedCredentials(raw = {}, config = {}) {
  const credentials = raw.credentials ?? raw;
  const token = credentials.bot_token ?? credentials.botToken ?? credentials.token;
  const accountId = credentials.ilink_bot_id ?? credentials.ilinkBotId ?? credentials.accountId;
  const ownerUserId = credentials.ilink_user_id ?? credentials.ilinkUserId ?? credentials.ownerUserId;
  const baseUrl = credentials.baseurl ?? credentials.baseUrl ?? config.baseUrl;

  if (!token || !accountId || !ownerUserId) {
    throw new WxbError("LOGIN_CREDENTIALS_INVALID", "iLink confirmed login response is missing required credentials.", {
      retryable: false,
      details: {
        hasToken: Boolean(token),
        hasAccountId: Boolean(accountId),
        hasOwnerUserId: Boolean(ownerUserId)
      }
    });
  }

  return {
    accountId: String(accountId),
    token: String(token),
    baseUrl,
    ownerUserId: String(ownerUserId),
    savedAt: new Date().toISOString()
  };
}

export async function loginWithQrcode(options = {}) {
  const {
    client,
    stateDir,
    config = {},
    maxPolls = 10,
    pollIntervalMs = 1000,
    onQrcode,
    onStatus
  } = options;

  if (!client) {
    throw new TypeError("client is required");
  }
  if (!stateDir) {
    throw new TypeError("stateDir is required");
  }

  const qrcode = normalizeQrcodeResponse(await client.getBotQrcode({ botType: config.qrBotType }));
  await onQrcode?.(qrcode);

  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    const statusResponse = await client.getQrcodeStatus(qrcode.qrcode, {
      timeoutMs: config.loginPollTimeoutMs
    });
    const status = String(statusResponse.status ?? "").toLowerCase();
    await onStatus?.({ attempt, status, raw: statusResponse });

    if (status === "confirmed") {
      const account = normalizeConfirmedCredentials(statusResponse, config);
      await withAccountLock(stateDir, account.accountId, () => saveAccount(stateDir, account));
      return {
        account: publicAccountView(account),
        qrcode: {
          imageUrl: qrcode.imageUrl,
          imageContent: qrcode.imageContent
        }
      };
    }

    if (status === "expired") {
      throw new WxbError("LOGIN_QRCODE_EXPIRED", "iLink QR code expired; run login again.", {
        retryable: false
      });
    }

    if (canceledQrStatuses.has(status)) {
      throw new WxbError("LOGIN_CANCELLED", "iLink QR login was cancelled.", {
        retryable: false
      });
    }

    if (!pendingQrStatuses.has(status)) {
      throw new WxbError("LOGIN_STATUS_UNKNOWN", `Unknown iLink QR login status: ${status || "<empty>"}`, {
        retryable: false,
        details: { status }
      });
    }

    if (attempt < maxPolls && pollIntervalMs > 0) {
      await sleep(pollIntervalMs);
    }
  }

  throw new WxbError("LOGIN_TIMEOUT", "Timed out waiting for iLink QR login confirmation.", {
    retryable: true
  });
}

export async function listPublicAccounts(stateDir) {
  return listAccounts(stateDir, { includeSecrets: false });
}

export async function getAccountStatuses(stateDir, options = {}) {
  const accounts = await listPublicAccounts(stateDir);
  const selectedAccounts = options.accountId
    ? accounts.filter((account) => account.accountId === options.accountId)
    : accounts;

  if (options.accountId && selectedAccounts.length === 0) {
    throw new WxbError("ACCOUNT_NOT_FOUND", `Account not found: ${options.accountId}`, {
      retryable: false,
      details: { accountId: options.accountId }
    });
  }

  const statuses = [];
  for (const account of selectedAccounts) {
    const [syncBuffer, contextTokens, history] = await Promise.all([
      readSyncBuffer(stateDir, account.accountId),
      readContextTokens(stateDir, account.accountId),
      readMessageHistory(stateDir, account.accountId)
    ]);

    statuses.push({
      ...account,
      connection: account.hasToken ? "configured" : "missing_token",
      sync: {
        hasBuffer: Boolean(syncBuffer),
        bufferLength: syncBuffer.length
      },
      conversations: {
        count: Object.keys(contextTokens).length
      },
      messages: {
        count: history.length
      }
    });
  }

  return statuses;
}
