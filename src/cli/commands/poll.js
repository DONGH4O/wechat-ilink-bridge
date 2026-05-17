import { parseCliArgs } from "../../config/load-config.js";
import { WxbError, cliSuccess } from "../../core/errors.js";
import { pollMessages } from "../../core/poll.js";

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

export async function runPollCommand(argv, context) {
  const flags = parseCliArgs(argv);
  const events = [];
  const jsonl = flags.jsonl === true;
  const summary = await pollMessages({
    stateDir: context.config.stateDir,
    accountId: flags.account === true ? undefined : flags.account,
    config: context.config,
    timeoutMs: optionalNumber(flags.timeout, { key: "timeout", min: 0 }) ?? context.config.fetchTimeoutMs,
    intervalMs: optionalNumber(flags.interval, { key: "interval", min: 0 })
      ?? optionalNumber(flags.intervalMs, { key: "intervalMs", min: 0 })
      ?? context.config.pollIntervalMs,
    maxIterations: optionalNumber(flags.limit, { key: "limit", min: 1 })
      ?? optionalNumber(flags.maxIterations, { key: "maxIterations", min: 1 })
      ?? 1,
    retry: {
      maxAttempts: optionalNumber(flags.maxAttempts, { key: "maxAttempts", min: 1 }) ?? 3,
      retryDelaysMs: context.retryDelaysMs
    },
    client: context.client,
    onEvent: async (event) => {
      if (jsonl) {
        context.stdout.write(`${JSON.stringify(event)}\n`);
      } else {
        events.push(event);
      }
    }
  });

  if (jsonl) {
    context.stdout.write(`${JSON.stringify({ event: "summary", ok: true, data: summary })}\n`);
    return undefined;
  }

  return cliSuccess({
    ...summary,
    events
  });
}
