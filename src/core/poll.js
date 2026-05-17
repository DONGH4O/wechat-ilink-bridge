import { fail } from "./errors.js";
import { fetchMessages } from "./fetch-messages.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollMessages(options = {}) {
  const {
    stateDir,
    accountId,
    config = {},
    timeoutMs = config.fetchTimeoutMs,
    intervalMs = config.pollIntervalMs ?? 1000,
    maxIterations = 1,
    retry,
    client,
    onEvent
  } = options;

  const summary = {
    iterations: 0,
    messageCount: 0,
    delayedDeliveryCount: 0,
    errorCount: 0,
    stoppedBy: "limit"
  };

  for (let index = 0; index < maxIterations; index += 1) {
    try {
      const result = await fetchMessages({
        stateDir,
        accountId,
        config,
        timeoutMs,
        retry,
        client
      });

      summary.iterations += 1;
      summary.messageCount += result.newMessageCount;
      summary.delayedDeliveryCount += result.delayedDeliveries?.filter((item) => item.status === "sent").length ?? 0;
      await onEvent?.({
        event: "fetch",
        ok: true,
        data: result
      });
    } catch (error) {
      summary.iterations += 1;
      summary.errorCount += 1;
      await onEvent?.({
        event: "error",
        ok: false,
        error: fail(error).error
      });

      if (!error.retryable) {
        summary.stoppedBy = "error";
        break;
      }
    }

    if (index < maxIterations - 1 && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }

  return summary;
}
