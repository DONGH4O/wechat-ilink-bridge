import { parseCliArgs } from "../../config/load-config.js";
import { cliSuccess, WxbError } from "../../core/errors.js";
import { sendMedia } from "../../core/send-media.js";
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
    if (!entry.includes("=") && !["stdin", "json", "typing", "no-queue", "queue", "queue-on-failure"].includes(key)) {
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
  const filePath = flags.file === true ? undefined : flags.file;
  const imagePath = flags.image === true ? undefined : flags.image;
  const mediaSources = [filePath ? "file" : undefined, imagePath ? "image" : undefined].filter(Boolean);

  const sourceCount = [hasTextFlag, wantsStdin, Boolean(filePath), Boolean(imagePath)]
    .filter(Boolean)
    .length;

  if (sourceCount > 1) {
    throw new WxbError("SEND_SOURCE_AMBIGUOUS", "Use only one of --text, --stdin, --file, or --image.", {
      retryable: false
    });
  }

  if (mediaSources.length === 1) {
    const result = await sendMedia({
      stateDir: context.config.stateDir,
      accountId: flags.account === true ? undefined : flags.account,
      userId,
      alias,
      filePath: filePath ?? imagePath,
      kind: mediaSources[0],
      config: context.config,
      timeoutMs: optionalNumber(flags.timeout) ?? context.config.fetchTimeoutMs,
      client: context.client,
      typing: flags.typing === true
    });

    return cliSuccess(result);
  }

  if (!hasTextFlag && !wantsStdin && positionals.length < (alias ? 1 : 2)) {
    throw new WxbError("SEND_SOURCE_REQUIRED", "Use --text, --stdin, --file, or --image.", {
      retryable: false
    });
  }

  const text = wantsStdin
    ? await readStream(context.stdin)
    : hasTextFlag
      ? String(flags.text)
      : (alias ? positionals : positionals.slice(1)).join(" ");

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
    queueOnNoContext: flags.queue === true || flags.queueOnFailure === true,
    typing: flags.typing === true
  });

  return cliSuccess(result);
}
