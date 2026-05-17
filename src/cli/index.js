#!/usr/bin/env node
import { WxbError, cliFailure, cliSuccess } from "../core/errors.js";
import { loadConfig } from "../config/load-config.js";
import { runAliasCommand } from "./commands/alias.js";
import { runAccountsCommand } from "./commands/accounts.js";
import { runCleanupCommand } from "./commands/cleanup.js";
import { runFetchCommand } from "./commands/fetch.js";
import { runHeartbeatCommand } from "./commands/heartbeat.js";
import { runLoginCommand } from "./commands/login.js";
import { runPollCommand } from "./commands/poll.js";
import { runQueueCommand } from "./commands/queue.js";
import { runSendCommand } from "./commands/send.js";
import { runStatusCommand } from "./commands/status.js";

const knownCommands = new Set(["login", "accounts", "status", "fetch", "send", "poll", "heartbeat", "alias", "queue", "cleanup"]);

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function help() {
  return cliSuccess({
    name: "wxb",
    milestone: "M8",
    commands: {
      login: "Scan-login and save an iLink account",
      accounts: "List saved accounts without tokens",
      status: "Show local account, cursor, conversation, and history status",
      fetch: "Long-poll one batch of inbound messages, optionally downloading media, and save local state",
      send: "Send text to a user using cached context token",
      poll: "Run repeated foreground fetch loops for keepalive and local processing",
      heartbeat: "Run one scheduled keepalive fetch without a daemon",
      alias: "Manage readable aliases for opaque user IDs",
      queue: "Inspect or clear delayed delivery queue items",
      cleanup: "Prune local message history and inbox attachments"
    }
  });
}

function maybePrintJson(payload) {
  if (payload !== undefined) {
    printJson(payload);
  }
}

function splitCommand(argv = []) {
  const configArgs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (!entry.startsWith("-")) {
      return {
        command: entry,
        commandArgs: argv.slice(index + 1),
        configArgs
      };
    }

    if (entry === "--help" || entry === "-h") {
      return {
        command: entry,
        commandArgs: argv.slice(index + 1),
        configArgs
      };
    }

    configArgs.push(entry);
    const next = argv[index + 1];
    if (entry.startsWith("--") && !entry.includes("=") && next && !next.startsWith("-") && !knownCommands.has(next)) {
      configArgs.push(next);
      index += 1;
    }
  }

  return {
    command: undefined,
    commandArgs: [],
    configArgs
  };
}

async function main(argv = process.argv.slice(2)) {
  const { command, commandArgs, configArgs } = splitCommand(argv);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printJson(help());
    return;
  }

  const config = await loadConfig({ argv: [...configArgs, ...commandArgs] });
  const context = {
    config,
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin
  };

  if (command === "login") {
    maybePrintJson(await runLoginCommand(commandArgs, context));
    return;
  }

  if (command === "accounts") {
    maybePrintJson(await runAccountsCommand(commandArgs, context));
    return;
  }

  if (command === "status") {
    maybePrintJson(await runStatusCommand(commandArgs, context));
    return;
  }

  if (command === "fetch") {
    maybePrintJson(await runFetchCommand(commandArgs, context));
    return;
  }

  if (command === "send") {
    maybePrintJson(await runSendCommand(commandArgs, context));
    return;
  }

  if (command === "poll") {
    maybePrintJson(await runPollCommand(commandArgs, context));
    return;
  }

  if (command === "heartbeat") {
    maybePrintJson(await runHeartbeatCommand(commandArgs, context));
    return;
  }

  if (command === "alias") {
    maybePrintJson(await runAliasCommand(commandArgs, context));
    return;
  }

  if (command === "queue") {
    maybePrintJson(await runQueueCommand(commandArgs, context));
    return;
  }

  if (command === "cleanup") {
    maybePrintJson(await runCleanupCommand(commandArgs, context));
    return;
  }

  throw new WxbError("COMMAND_NOT_IMPLEMENTED", `Command is not implemented in this P0 build: ${command}`, {
    retryable: false,
    details: { command }
  });
}

main().catch((error) => {
  printJson(cliFailure(error));
  process.exitCode = 1;
});
