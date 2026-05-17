import { parseCliArgs } from "../../config/load-config.js";
import { WxbError, cliSuccess } from "../../core/errors.js";
import { fetchMessages } from "../../core/fetch-messages.js";

function optionalNumber(value, options = {}) {
  if (value === undefined || value === true) {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new WxbError("CONFIG_VALUE_INVALID", `Expected numeric flag value for ${options.key ?? "flag"}.`, {
      retryable: false,
      details: { key: options.key, value }
    });
  }
  if (options.min !== undefined && numberValue < options.min) {
    throw new WxbError("CONFIG_VALUE_INVALID", `${options.key ?? "flag"} must be greater than or equal to ${options.min}.`, {
      retryable: false,
      details: { key: options.key, value: numberValue, min: options.min }
    });
  }
  return numberValue;
}

export async function runFetchCommand(argv, context) {
  const flags = parseCliArgs(argv);
  const result = await fetchMessages({
    stateDir: context.config.stateDir,
    accountId: flags.account === true ? undefined : flags.account,
    config: context.config,
    timeoutMs: optionalNumber(flags.timeout, { key: "timeout" }) ?? context.config.fetchTimeoutMs,
    retry: {
      maxAttempts: optionalNumber(flags.maxAttempts, { key: "maxAttempts", min: 1 }) ?? 3,
      retryDelaysMs: context.retryDelaysMs
    },
    client: context.client,
    downloadMedia: flags.downloadMedia === true || flags.media === true,
    mediaFetchImpl: context.mediaFetchImpl
  });

  return cliSuccess(result);
}
