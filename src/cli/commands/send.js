import { parseCliArgs } from "../../config/load-config.js";
import { cliSuccess, WxbError } from "../../core/errors.js";
import { sendText } from "../../core/send-text.js";

function optionalNumber(value) {
  if (value === undefined || value === true) {
    return undefined;
  }
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new WxbError("CONFIG_VALUE_INVALID", "Expected numeric flag value for timeout.", {
      retryable: false,
      details: { key: "timeout", value }
    });
  }
  return numberValue;
}

function collectPositionals(argv = []) {
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith("--")) {
      positionals.push(entry);
      continue;
    }

    const key = entry.slice(2).split("=", 1)[0];
    if (!entry.includes("=") && !["stdin", "json"].includes(key)) {
      index += 1;
    }
  }
  return positionals;
}

async function readStream(stream) {
  const chunks = [];
  stream.setEncoding("utf8");
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks.join("");
}

export async function runSendCommand(argv, context) {
  const flags = parseCliArgs(argv);
  const positionals = collectPositionals(argv);
  const alias = flags.alias === true ? undefined : flags.alias;
  const userId = flags.user === true ? undefined : flags.user ?? (alias ? undefined : positionals[0]);
  const hasTextFlag = flags.text !== undefined && flags.text !== true;
  const wantsStdin = flags.stdin === true;

  if (hasTextFlag && wantsStdin) {
    throw new WxbError("TEXT_SOURCE_AMBIGUOUS", "Use either --text or --stdin, not both.", {
      retryable: false
    });
  }

  const text = wantsStdin
    ? await readStream(context.stdin)
    : hasTextFlag
      ? String(flags.text)
      : positionals.slice(1).join(" ");

  const result = await sendText({
    stateDir: context.config.stateDir,
    accountId: flags.account === true ? undefined : flags.account,
    userId,
    alias,
    text,
    config: context.config,
    timeoutMs: optionalNumber(flags.timeout) ?? context.config.fetchTimeoutMs,
    client: context.client,
    queueOnInvalidContext: flags.noQueue !== true,
    queueOnNoContext: flags.queue === true || flags.queueOnFailure === true
  });

  return cliSuccess(result);
}
