import { WxbError } from "./errors.js";
import { generateClientId, IlinkClient } from "./ilink-client.js";
import { chunkText } from "./chunk-text.js";
import { listAccounts } from "../state/account-store.js";
import { resolveAlias } from "../state/alias-store.js";
import { resolveContextToken } from "../state/context-token-store.js";
import { appendMessageHistory } from "../state/message-history.js";
import { withAccountLock } from "../state/lock.js";
import { queueTextDelivery } from "./delivery-queue.js";
import { withOptionalTyping } from "./typing.js";

export async function resolveSendAccount(stateDir, accountId) {
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

export function resolveTargetUser(userId) {
  if (!userId || typeof userId !== "string") {
    throw new WxbError("TARGET_USER_REQUIRED", "A target user ID is required.", {
      retryable: false
    });
  }

  return userId;
}

export async function resolveTargetUserOrAlias(stateDir, options = {}) {
  if (options.alias) {
    const matches = await resolveAlias(stateDir, String(options.alias));

    if (!matches?.length) {
      throw new WxbError("ALIAS_NOT_FOUND", `Alias not found: ${options.alias}`, {
        retryable: false,
        details: { alias: options.alias }
      });
    }

    if (matches.length > 1) {
      throw new WxbError("ALIAS_AMBIGUOUS", `Alias resolves to multiple users: ${options.alias}`, {
        retryable: false,
        details: { alias: options.alias, userIds: matches }
      });
    }

    return matches[0];
  }

  return resolveTargetUser(options.userId);
}

export async function sendText(options = {}) {
  const {
    stateDir,
    accountId,
    userId,
    text,
    config = {},
    client: providedClient,
    timeoutMs = config.fetchTimeoutMs,
    chunkOptions = {},
    queueOnInvalidContext = true,
    queueOnNoContext = false,
    typing = false
  } = options;

  if (!stateDir) {
    throw new TypeError("stateDir is required");
  }

  const targetUserId = await resolveTargetUserOrAlias(stateDir, {
    userId,
    alias: options.alias
  });
  const account = await resolveSendAccount(stateDir, accountId);
  const chunks = chunkText(text, {
    minChunkChars: config.minChunkChars,
    maxChunkChars: config.maxChunkChars,
    maxMessages: config.maxDeliveryMessages,
    ...chunkOptions
  });
  const client = providedClient ?? new IlinkClient({
    baseUrl: account.baseUrl ?? config.baseUrl,
    channelVersion: config.channelVersion
  });

  return withAccountLock(stateDir, account.accountId, async () => {
    const contextToken = await resolveContextToken(stateDir, account.accountId, targetUserId);
    if (!contextToken) {
      if (queueOnNoContext) {
        const queued = await queueTextDelivery({
          stateDir,
          accountId: account.accountId,
          userId: targetUserId,
          text,
          source: "no_context",
          maxItems: config.delayedQueueMaxItems,
          lock: false
        });

        return {
          accountId: account.accountId,
          toUserId: targetUserId,
          delivered: false,
          queued: true,
          queue: queued
        };
      }

      throw new WxbError("NO_CONTEXT_TOKEN", "No context token is cached for this user; fetch an inbound message first.", {
        retryable: false,
        details: {
          accountId: account.accountId,
          userId: targetUserId
        }
      });
    }

    return withOptionalTyping({
      enabled: typing,
      client,
      token: account.token,
      stateDir,
      accountId: account.accountId,
      userId: targetUserId,
      contextToken,
      timeoutMs
    }, async (activeContextToken) => {
      const sent = [];
      const startedAt = Math.floor(Date.now() / 1000);

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const clientId = generateClientId();

        try {
          await client.sendTextMessage({
            token: account.token,
            toUserId: targetUserId,
            text: chunk,
            contextToken: activeContextToken,
            clientId,
            timeoutMs
          });
        } catch (error) {
          if (!(error instanceof WxbError)) {
            throw error;
          }

          if (queueOnInvalidContext && error.code === "INVALID_CONTEXT_TOKEN" && sent.length === 0) {
            const queued = await queueTextDelivery({
              stateDir,
              accountId: account.accountId,
              userId: targetUserId,
              text,
              source: "invalid_context",
              error,
              maxItems: config.delayedQueueMaxItems,
              lock: false
            });

            return {
              accountId: account.accountId,
              toUserId: targetUserId,
              delivered: false,
              queued: true,
              queue: queued
            };
          }

          throw new WxbError(error.code, error.message, {
            retryable: error.retryable,
            status: error.status,
            details: {
              ...(error.details ?? {}),
              sentCount: sent.length,
              failedChunkIndex: sent.length + 1,
              totalChunks: chunks.length
            }
          });
        }

        const entry = {
          id: clientId,
          direction: "outgoing",
          fromUserId: account.ownerUserId,
          toUserId: targetUserId,
          timestamp: startedAt,
          type: "text",
          text: chunk,
          contextToken: activeContextToken,
          chunkIndex: index + 1,
          chunkCount: chunks.length
        };
        const sentItem = {
          clientId: entry.id,
          chunkIndex: entry.chunkIndex,
          chars: chunk.length
        };

        try {
          await appendMessageHistory(stateDir, account.accountId, entry);
        } catch (error) {
          throw new WxbError("OUTGOING_HISTORY_WRITE_FAILED", "Message was sent but local outgoing history could not be written.", {
            retryable: false,
            details: {
              delivered: true,
              sentCount: sent.length + 1,
              failedChunkIndex: entry.chunkIndex,
              totalChunks: chunks.length,
              clientId: entry.id,
              deliveredClientIds: [...sent.map((item) => item.clientId), entry.id],
              cause: error?.message ?? String(error)
            }
          });
        }

        sent.push(sentItem);
      }

      return {
        accountId: account.accountId,
        toUserId: targetUserId,
        chunkCount: chunks.length,
        sent
      };
    });
  });
}
