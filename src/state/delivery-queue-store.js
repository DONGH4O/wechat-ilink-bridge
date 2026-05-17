import { randomBytes } from "node:crypto";
import { accountStatePath, ensureStateDir } from "./state-dir.js";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";
import { withAccountLock } from "./lock.js";

export function deliveryQueueFilePath(stateDir, accountId) {
  return accountStatePath(stateDir, accountId, ".delivery-queue.json");
}

function normalizeQueue(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  return [];
}

export async function readDeliveryQueue(stateDir, accountId) {
  return normalizeQueue(await readJsonFile(deliveryQueueFilePath(stateDir, accountId), { version: 1, items: [] }));
}

export async function writeDeliveryQueue(stateDir, accountId, items) {
  await ensureStateDir(stateDir);
  await writeJsonAtomic(deliveryQueueFilePath(stateDir, accountId), {
    version: 1,
    items: Array.from(items ?? [])
  });
}

function makeQueueId(now = Date.now()) {
  return `queued-${now}-${randomBytes(4).toString("hex")}`;
}

async function enqueueDeliveryUnlocked(stateDir, accountId, delivery, options = {}) {
  const items = await readDeliveryQueue(stateDir, accountId);
  const maxItems = options.maxItems ?? 100;
  const nextItem = {
    id: delivery.id ?? makeQueueId(),
    userId: String(delivery.userId),
    text: String(delivery.text ?? ""),
    createdAt: delivery.createdAt ?? new Date().toISOString(),
    attempts: delivery.attempts ?? 0,
    source: delivery.source ?? "send",
    ...(delivery.lastAttemptAt ? { lastAttemptAt: delivery.lastAttemptAt } : {}),
    ...(delivery.lastError ? { lastError: delivery.lastError } : {})
  };

  const nextItems = [...items, nextItem];
  const trimmed = nextItems.length > maxItems ? nextItems.slice(-maxItems) : nextItems;
  await writeDeliveryQueue(stateDir, accountId, trimmed);
  return nextItem;
}

export async function enqueueDelivery(stateDir, accountId, delivery, options = {}) {
  if (options.lock === false) {
    return enqueueDeliveryUnlocked(stateDir, accountId, delivery, options);
  }

  return withAccountLock(stateDir, accountId, () => enqueueDeliveryUnlocked(stateDir, accountId, delivery, options));
}

async function updateQueuedDeliveryUnlocked(stateDir, accountId, queueId, updater) {
  const items = await readDeliveryQueue(stateDir, accountId);
  const updated = items.map((item) => (item.id === queueId ? updater(item) : item));
  await writeDeliveryQueue(stateDir, accountId, updated);
  return updated.find((item) => item.id === queueId);
}

export async function updateQueuedDelivery(stateDir, accountId, queueId, updater, options = {}) {
  if (options.lock === false) {
    return updateQueuedDeliveryUnlocked(stateDir, accountId, queueId, updater);
  }

  return withAccountLock(stateDir, accountId, () => updateQueuedDeliveryUnlocked(stateDir, accountId, queueId, updater));
}

async function removeQueuedDeliveryUnlocked(stateDir, accountId, queueId) {
  const items = await readDeliveryQueue(stateDir, accountId);
  const nextItems = items.filter((item) => item.id !== queueId);
  await writeDeliveryQueue(stateDir, accountId, nextItems);
  return items.length - nextItems.length;
}

export async function removeQueuedDelivery(stateDir, accountId, queueId, options = {}) {
  if (options.lock === false) {
    return removeQueuedDeliveryUnlocked(stateDir, accountId, queueId);
  }

  return withAccountLock(stateDir, accountId, () => removeQueuedDeliveryUnlocked(stateDir, accountId, queueId));
}

async function clearDeliveryQueueUnlocked(stateDir, accountId, options = {}) {
  const predicate = options.userId
    ? (item) => item.userId !== String(options.userId)
    : () => false;
  const items = await readDeliveryQueue(stateDir, accountId);
  const nextItems = items.filter(predicate);
  await writeDeliveryQueue(stateDir, accountId, nextItems);
  return items.length - nextItems.length;
}

export async function clearDeliveryQueue(stateDir, accountId, options = {}) {
  if (options.lock === false) {
    return clearDeliveryQueueUnlocked(stateDir, accountId, options);
  }

  return withAccountLock(stateDir, accountId, () => clearDeliveryQueueUnlocked(stateDir, accountId, options));
}
