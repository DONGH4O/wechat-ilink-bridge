import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { WxbError } from "../core/errors.js";
import { accountStatePath } from "./state-dir.js";

export function messageHistoryFilePath(stateDir, accountId) {
  return accountStatePath(stateDir, accountId, ".messages.jsonl");
}

export async function appendMessageHistory(stateDir, accountId, messageOrMessages) {
  const messages = Array.isArray(messageOrMessages) ? messageOrMessages : [messageOrMessages];
  const filePath = messageHistoryFilePath(stateDir, accountId);
  await mkdir(path.dirname(filePath), { recursive: true });

  const handle = await open(filePath, "a");
  try {
    for (const message of messages) {
      await handle.write(`${JSON.stringify(message)}\n`, "utf8");
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function readMessageHistory(stateDir, accountId) {
  const filePath = messageHistoryFilePath(stateDir, accountId);
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (parseError) {
          throw new WxbError("STATE_JSONL_INVALID", `Message history file contains invalid JSONL: ${filePath}`, {
            retryable: false,
            details: {
              filePath,
              lineNumber: index + 1,
              cause: parseError.message,
              recoveryHint: "Move the corrupted messages JSONL file aside to preserve evidence, then run wxb fetch again to continue from the saved cursor."
            }
          });
        }
      });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function replaceMessageHistory(stateDir, accountId, messages) {
  const filePath = messageHistoryFilePath(stateDir, accountId);
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const content = messages.map((message) => JSON.stringify(message)).join("\n");

  try {
    await writeFile(tempPath, content ? `${content}\n` : "", "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
