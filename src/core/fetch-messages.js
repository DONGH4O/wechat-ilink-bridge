import { createHash } from "node:crypto";
import { WxbError } from "./errors.js";
import { IlinkClient } from "./ilink-client.js";
import { normalizeUpdateResponse } from "./message-normalizer.js";
import { flushOneQueuedDeliveryForUser } from "./delivery-queue.js";
import { downloadMessagesMedia, stripMessageMediaSecrets } from "./media-download.js";
import { listAccounts } from "../state/account-store.js";
import { rememberContextToken } from "../state/context-token-store.js";
import { appendMessageHistory } from "../state/message-history.js";
import { readSeenIds, markSeenIds } from "../state/seen-store.js";
import { readSyncBuffer, writeSyncBuffer } from "../state/sync-buffer-store.js";
import { withAccountLock } from "../state/lock.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripInternalMessageFields(message) {
  const { contextToken, ...publicMessage } = stripMessageMediaSecrets(message);
  return publicMessage;
}

function makeSyntheticMessageId(message, index) {
  const hash = createHash("sha256")
    .update(JSON.stringify({ index, message: stripInternalMessageFields(message) }))
    .digest("hex")
    .slice(0, 16);
  return `synthetic-${hash}`;
}

function ensureMessageIds(messages) {
  return messages.map((message, index) => {
    if (message.id) {
      return message;
    }

    return {
      ...message,
      id: makeSyntheticMessageId(message, index)
    };
  });
}

export async function resolveFetchAccount(stateDir, accountId) {
  const accounts = await listAccounts(stateDir, { includeSecrets: true });

  if (accountId) {
    const account = accounts.find((entry) => entry.accountId === accountId);
    if (!account) {
      throw new WxbError("ACCOUNT_NOT_FOUND", `Account not found: ${accountId}`, {
        retryable: false,
        details: { accountId }
      });
    }
    return account;
  }

  if (accounts.length === 0) {
    throw new WxbError("NO_ACCOUNT", "No iLink account is saved; run wxb login first.", {
      retryable: false
    });
  }

  if (accounts.length > 1) {
    throw new WxbError("ACCOUNT_REQUIRED", "Multiple iLink accounts are saved; pass --account <id>.", {
      retryable: false,
      details: { accountIds: accounts.map((account) => account.accountId) }
    });
  }

  return accounts[0];
}

async function getUpdatesWithRetry(client, request, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelaysMs = options.retryDelaysMs ?? [1000, 2000, 4000];
  let lastError;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new WxbError("CONFIG_VALUE_INVALID", "maxAttempts must be an integer greater than or equal to 1.", {
      retryable: false,
      details: { key: "maxAttempts", value: maxAttempts }
    });
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        response: await client.getUpdates(request),
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt >= maxAttempts) {
        throw error;
      }
      const delay = retryDelaysMs[Math.min(attempt - 1, retryDelaysMs.length - 1)] ?? 0;
      if (delay > 0) {
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

export async function fetchMessages(options = {}) {
  const {
    stateDir,
    accountId,
    config = {},
    timeoutMs = config.fetchTimeoutMs,
    client: providedClient,
    retry = {},
    downloadMedia = false,
    mediaFetchImpl
  } = options;

  if (!stateDir) {
    throw new TypeError("stateDir is required");
  }

  const account = await resolveFetchAccount(stateDir, accountId);
  const client = providedClient ?? new IlinkClient({
    baseUrl: account.baseUrl ?? config.baseUrl,
    channelVersion: config.channelVersion
  });

  return withAccountLock(stateDir, account.accountId, async () => {
    const previousBuffer = await readSyncBuffer(stateDir, account.accountId);
    const { response, attempts } = await getUpdatesWithRetry(client, {
      token: account.token,
      getUpdatesBuf: previousBuffer,
      timeoutMs
    }, retry);

    const normalized = normalizeUpdateResponse(response, {
      includeContextToken: true,
      includeMediaSecrets: downloadMedia
    });
    const normalizedMessages = ensureMessageIds(normalized.messages);
    const seenIds = new Set(await readSeenIds(stateDir, account.accountId));
    const unseenMessages = normalizedMessages.filter((message) => !seenIds.has(message.id));
    const messages = downloadMedia
      ? await downloadMessagesMedia(unseenMessages, {
        stateDir,
        accountId: account.accountId,
        config,
        fetchImpl: mediaFetchImpl ?? client.fetchImpl,
        timeoutMs
      })
      : unseenMessages.map(stripMessageMediaSecrets);
    const nextBuffer = normalized.getUpdatesBuf ?? previousBuffer;
    const newMessages = messages;

    for (const message of newMessages) {
      if (message.fromUserId && message.contextToken) {
        await rememberContextToken(stateDir, account.accountId, message.fromUserId, message.contextToken, { lock: false });
      }
    }

    if (newMessages.length > 0) {
      await appendMessageHistory(stateDir, account.accountId, newMessages);
      await markSeenIds(stateDir, account.accountId, newMessages.map((message) => message.id), { lock: false });
    }

    const delayedCandidatesByUser = new Map();
    for (const message of newMessages) {
      if (!message.fromUserId || !message.contextToken) {
        continue;
      }

      delayedCandidatesByUser.set(String(message.fromUserId), message.contextToken);
    }

    const delayedDeliveries = [];
    for (const [userId, contextToken] of delayedCandidatesByUser) {
      if (!contextToken) {
        continue;
      }

      const delivery = await flushOneQueuedDeliveryForUser({
        stateDir,
        account,
        userId,
        contextToken,
        client,
        config,
        timeoutMs
      });

      if (delivery.status !== "none") {
        delayedDeliveries.push(delivery);
      }
    }

    await writeSyncBuffer(stateDir, account.accountId, nextBuffer);

    return {
      accountId: account.accountId,
      cursor: {
        previous: previousBuffer,
        current: nextBuffer,
        advanced: nextBuffer !== previousBuffer
      },
      attempts,
      messages: newMessages.map(stripInternalMessageFields),
      delayedDeliveries,
      rawMessageCount: normalized.messages.length,
      newMessageCount: newMessages.length
    };
  });
}
