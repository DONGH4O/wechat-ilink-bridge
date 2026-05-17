import { WxbError } from "./errors.js";
import { chunkText } from "./chunk-text.js";
import { generateClientId } from "./ilink-client.js";
import { appendMessageHistory } from "../state/message-history.js";
import {
  enqueueDelivery,
  readDeliveryQueue,
  removeQueuedDelivery,
  updateQueuedDelivery
} from "../state/delivery-queue-store.js";

function publicQueueItem(item) {
  return {
    id: item.id,
    userId: item.userId,
    chars: item.text.length,
    createdAt: item.createdAt,
    attempts: item.attempts,
    source: item.source,
    ...(item.lastAttemptAt ? { lastAttemptAt: item.lastAttemptAt } : {}),
    ...(item.lastError ? { lastError: item.lastError } : {})
  };
}

export async function queueTextDelivery(options = {}) {
  const {
    stateDir,
    accountId,
    userId,
    text,
    source = "send",
    error,
    maxItems,
    lock
  } = options;

  if (!stateDir || !accountId) {
    throw new TypeError("stateDir and accountId are required");
  }

  if (!userId) {
    throw new WxbError("TARGET_USER_REQUIRED", "A target user ID is required.", {
      retryable: false
    });
  }

  const item = await enqueueDelivery(stateDir, accountId, {
    userId,
    text,
    source,
    lastError: error
      ? {
        code: error.code ?? "UNKNOWN_ERROR",
        message: error.message ?? String(error)
      }
      : undefined
  }, {
    maxItems,
    lock
  });

  return publicQueueItem(item);
}

export async function listQueuedDeliveries(stateDir, accountId) {
  const items = await readDeliveryQueue(stateDir, accountId);
  return items.map(publicQueueItem);
}

function stripSecretError(error) {
  return {
    code: error.code ?? "UNKNOWN_ERROR",
    message: error.message ?? String(error),
    retryable: Boolean(error.retryable)
  };
}

export async function flushOneQueuedDeliveryForUser(options = {}) {
  const {
    stateDir,
    account,
    userId,
    contextToken,
    client,
    config = {},
    timeoutMs = config.fetchTimeoutMs
  } = options;

  if (!stateDir || !account?.accountId || !client) {
    throw new TypeError("stateDir, account, and client are required");
  }

  const queue = await readDeliveryQueue(stateDir, account.accountId);
  const item = queue.find((entry) => entry.userId === String(userId));

  if (!item) {
    return {
      status: "none",
      userId: String(userId)
    };
  }

  if (!contextToken) {
    return {
      status: "skipped",
      userId: String(userId),
      queueId: item.id,
      reason: "NO_CONTEXT_TOKEN"
    };
  }

  const chunks = chunkText(item.text, {
    minChunkChars: config.minChunkChars,
    maxChunkChars: config.maxChunkChars,
    maxMessages: config.maxDeliveryMessages
  });
  const sent = [];
  const startedAt = Math.floor(Date.now() / 1000);

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const text = chunks[index];
      const clientId = generateClientId();
      await client.sendTextMessage({
        token: account.token,
        toUserId: item.userId,
        text,
        contextToken,
        clientId,
        timeoutMs
      });

      await appendMessageHistory(stateDir, account.accountId, {
        id: clientId,
        direction: "outgoing",
        fromUserId: account.ownerUserId,
        toUserId: item.userId,
        timestamp: startedAt,
        type: "text",
        text,
        contextToken,
        chunkIndex: index + 1,
        chunkCount: chunks.length,
        delayedDeliveryId: item.id
      });

      sent.push({
        clientId,
        chunkIndex: index + 1,
        chars: text.length
      });
    }

    await removeQueuedDelivery(stateDir, account.accountId, item.id, { lock: false });
    return {
      status: "sent",
      userId: item.userId,
      queueId: item.id,
      chunkCount: chunks.length,
      sent
    };
  } catch (error) {
    await updateQueuedDelivery(stateDir, account.accountId, item.id, (current) => ({
      ...current,
      attempts: (current.attempts ?? 0) + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: stripSecretError(error)
    }), { lock: false });

    return {
      status: "failed",
      userId: item.userId,
      queueId: item.id,
      error: stripSecretError(error)
    };
  }
}
