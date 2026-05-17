import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("wxb M12 CLI entry emits JSON help", async () => {
  const cliPath = path.resolve("src", "cli", "index.js");
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "help"], {
    cwd: path.resolve(".")
  });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.name, "wxb");
  assert.equal(parsed.data.milestone, "M12");
  assert.equal(parsed.data.commands.login, "Scan-login and save an iLink account");
  assert.equal(parsed.data.commands.fetch, "Long-poll one batch of inbound messages, optionally downloading media, and save local state");
  assert.equal(parsed.data.commands.send, "Send text, files, or images to a user using cached context token");
  assert.equal(parsed.data.commands.poll, "Run repeated foreground fetch loops for keepalive and local processing");
  assert.equal(parsed.data.commands.cleanup, "Prune local message history and inbox attachments");
});

test("wxb M12 CLI entry emits structured errors for unknown commands", async () => {
  const cliPath = path.resolve("src", "cli", "index.js");

  await assert.rejects(
    execFileAsync(process.execPath, [cliPath, "frobnicate"], {
      cwd: path.resolve(".")
    }),
    (error) => {
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "COMMAND_NOT_IMPLEMENTED");
      assert.equal(parsed.error.details.command, "frobnicate");
      return true;
    }
  );
});
