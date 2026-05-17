#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IlinkClient } from "../src/core/ilink-client.js";
import { normalizeUpdateResponse } from "../src/core/message-normalizer.js";
import { fail } from "../src/core/errors.js";
import { protocolDefaults } from "../src/core/protocol-constants.js";
import { redactSensitiveData } from "../src/core/redact.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const flags = {};
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = rest[index + 1];
      if (!next || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        index += 1;
      }
    } else {
      positional.push(value);
    }
  }

  return { command, flags, positional };
}

function envOrFlag(flags, flagName, envName, fallback) {
  return flags[flagName] ?? process.env[envName] ?? fallback;
}

async function saveRawFixture(name, payload) {
  const rawDir = path.join(rootDir, "test", "fixtures", "raw");
  await mkdir(rawDir, { recursive: true });
  const safeName = name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
  const filePath = path.join(rawDir, `live-${safeName}-${Date.now()}.json`);
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function usage() {
  return {
    ok: true,
    usage: [
      "node scripts/protocol-spike.js qrcode [--save qrcode]",
      "node scripts/protocol-spike.js qrcode-status --qrcode <token> [--save qrcode-status]",
      "node scripts/protocol-spike.js getupdates --token <botToken> [--buffer <cursor>] [--timeout 15000] [--save getupdates]",
      "node scripts/protocol-spike.js send-text --token <botToken> --user <userId> --context <contextToken> --text <text> [--save send-text]",
      "node scripts/protocol-spike.js normalize --fixture test/fixtures/raw/getupdates-text-message.json",
      "Add --raw to print and save unredacted live API payloads."
    ],
    env: [
      "WX_BASE_URL",
      "WX_CHANNEL_VERSION",
      "WX_BOT_TOKEN"
    ]
  };
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const client = new IlinkClient({
    baseUrl: envOrFlag(flags, "base-url", "WX_BASE_URL", protocolDefaults.baseUrl),
    channelVersion: envOrFlag(flags, "channel-version", "WX_CHANNEL_VERSION", protocolDefaults.channelVersion)
  });

  let result;

  if (command === "help" || flags.help) {
    printJson(usage());
    return;
  }

  if (command === "qrcode") {
    result = await client.getBotQrcode({
      botType: Number(envOrFlag(flags, "bot-type", "WX_QR_BOT_TYPE", protocolDefaults.qrBotType))
    });
  } else if (command === "qrcode-status") {
    if (!flags.qrcode) {
      throw new Error("--qrcode is required");
    }
    result = await client.getQrcodeStatus(flags.qrcode);
  } else if (command === "getupdates") {
    const token = envOrFlag(flags, "token", "WX_BOT_TOKEN");
    if (!token) {
      throw new Error("--token or WX_BOT_TOKEN is required");
    }
    result = await client.getUpdates({
      token,
      getUpdatesBuf: flags.buffer ?? "",
      timeoutMs: Number(flags.timeout ?? protocolDefaults.fetchTimeoutMs)
    });
  } else if (command === "send-text") {
    const token = envOrFlag(flags, "token", "WX_BOT_TOKEN");
    if (!token || !flags.user || !flags.context || !flags.text) {
      throw new Error("--token/WX_BOT_TOKEN, --user, --context, and --text are required");
    }
    result = await client.sendTextMessage({
      token,
      toUserId: flags.user,
      contextToken: flags.context,
      text: flags.text
    });
  } else if (command === "normalize") {
    if (!flags.fixture) {
      throw new Error("--fixture is required");
    }
    const absoluteFixture = path.resolve(rootDir, flags.fixture);
    const raw = JSON.parse(await readFile(absoluteFixture, "utf8"));
    result = normalizeUpdateResponse(raw);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  if (flags.save) {
    const outputResult = flags.raw ? result : redactSensitiveData(result);
    const filePath = await saveRawFixture(String(flags.save), outputResult);
    printJson({ ok: true, saved: filePath, redacted: !flags.raw, result: outputResult });
    return;
  }

  printJson({ ok: true, redacted: !flags.raw, result: flags.raw ? result : redactSensitiveData(result) });
}

main().catch((error) => {
  printJson(fail(error));
  process.exitCode = 1;
});
