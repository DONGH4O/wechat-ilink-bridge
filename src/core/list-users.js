import { WxbError } from "./errors.js";
import { listPublicAccounts } from "./auth.js";
import { readAliases } from "../state/alias-store.js";
import { readContextTokens } from "../state/context-token-store.js";
import { readMessageHistory } from "../state/message-history.js";

function pickMessageUsers(message, ownerUserId) {
  const userIds = new Set();
  const fromUserId = message.fromUserId ? String(message.fromUserId) : undefined;
  const toUserId = message.toUserId ? String(message.toUserId) : undefined;

  if (message.direction === "incoming" && fromUserId) {
    userIds.add(fromUserId);
  } else if (message.direction === "outgoing" && toUserId) {
    userIds.add(toUserId);
  } else {
    for (const candidate of [fromUserId, toUserId]) {
      if (candidate && candidate !== ownerUserId) {
        userIds.add(candidate);
      }
    }
  }

  return userIds;
}

function ensureUser(usersById, userId, aliases, contextTokens) {
  const normalizedUserId = String(userId);
  if (!usersById.has(normalizedUserId)) {
    usersById.set(normalizedUserId, {
      userId: normalizedUserId,
      ...(aliases[normalizedUserId] ? { alias: aliases[normalizedUserId] } : {}),
      hasContextToken: Object.hasOwn(contextTokens, normalizedUserId),
      messageCount: 0
    });
  }

  return usersById.get(normalizedUserId);
}

function sortUsers(users) {
  return users.sort((left, right) => {
    const leftTime = left.lastMessageAt ?? 0;
    const rightTime = right.lastMessageAt ?? 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return left.userId.localeCompare(right.userId);
  });
}

export async function listUsers(stateDir, options = {}) {
  if (!stateDir) {
    throw new TypeError("stateDir is required");
  }

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

  const aliases = await readAliases(stateDir);
  const accountResults = [];

  for (const account of selectedAccounts) {
    const [contextTokens, history] = await Promise.all([
      readContextTokens(stateDir, account.accountId),
      readMessageHistory(stateDir, account.accountId)
    ]);
    const usersById = new Map();

    for (const userId of Object.keys(contextTokens)) {
      ensureUser(usersById, userId, aliases, contextTokens);
    }

    for (const message of history) {
      const messageUsers = pickMessageUsers(message, account.ownerUserId);
      for (const userId of messageUsers) {
        const user = ensureUser(usersById, userId, aliases, contextTokens);
        user.messageCount += 1;
        if (Number.isFinite(Number(message.timestamp))) {
          user.lastMessageAt = Math.max(user.lastMessageAt ?? 0, Number(message.timestamp));
        }
      }
    }

    const users = sortUsers([...usersById.values()]);
    accountResults.push({
      accountId: account.accountId,
      ownerUserId: account.ownerUserId,
      users,
      count: users.length
    });
  }

  return {
    accounts: accountResults,
    count: accountResults.length,
    userCount: accountResults.reduce((sum, account) => sum + account.count, 0)
  };
}
