import { parseCliArgs } from "../../config/load-config.js";
import { fetchMessages } from "../../core/fetch-messages.js";
import { WxbError, cliSuccess } from "../../core/errors.js";

function optionalNumber(value, options = {}) {
  if (value === undefined || value === true) {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || (options.min !== undefined && numberValue < options.min)) {
    throw new WxbError("CONFIG_VALUE_INVALID", `${options.key ?? "value"} must be a valid number.`, {
      retryable: false,
      details: { key: options.key, value, ...(options.min !== undefined ? { min: options.min } : {}) }
    });
  }
  return numberValue;
}

export async function runHeartbeatCommand(argv, context) {
  const flags = parseCliArgs(argv);
  let result;
  let timedOut = false;

  try {
    result = await fetchMessages({
      stateDir: context.config.stateDir,
      accountId: flags.account === true ? undefined : flags.account,
      config: context.config,
      timeoutMs: optionalNumber(flags.timeout, { key: "timeout", min: 0 }) ?? context.config.fetchTimeoutMs,
      retry: {
        maxAttempts: optionalNumber(flags.maxAttempts, { key: "maxAttempts", min: 1 }) ?? 1,
        retryDelaysMs: context.retryDelaysMs
      },
      client: context.client
    });
  } catch (error) {
    if (error instanceof WxbError && error.code === "NETWORK_ERROR" && error.details?.cause === "request timeout") {
      timedOut = true;
    } else {
      throw error;
    }
  }

  return cliSuccess({
    heartbeatAt: new Date().toISOString(),
    status: timedOut ? "idle_timeout" : "ok",
    ...(result
      ? {
        accountId: result.accountId,
        cursor: result.cursor,
        attempts: result.attempts,
        newMessageCount: result.newMessageCount,
        delayedDeliveries: result.delayedDeliveries
      }
      : {
        attempts: 1,
        newMessageCount: 0,
        delayedDeliveries: []
      })
  });
}
