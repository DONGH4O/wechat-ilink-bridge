import { parseCliArgs } from "../../config/load-config.js";
import { cleanupState } from "../../core/cleanup.js";
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

export async function runCleanupCommand(argv, context) {
  const flags = parseCliArgs(argv);
  const result = await cleanupState({
    stateDir: context.config.stateDir,
    accountId: flags.account === true ? undefined : flags.account,
    dryRun: flags.dryRun === true,
    messageRetentionDays: optionalNumber(flags.messageRetentionDays, { key: "messageRetentionDays", min: 0 })
      ?? context.config.messageRetentionDays,
    attachmentRetentionDays: optionalNumber(flags.attachmentRetentionDays, { key: "attachmentRetentionDays", min: 0 })
      ?? context.config.attachmentRetentionDays,
    maxHistoryMessages: optionalNumber(flags.maxHistoryMessages, { key: "maxHistoryMessages", min: 0 })
      ?? context.config.maxHistoryMessages,
    nowMs: context.nowMs
  });

  return cliSuccess(result);
}
