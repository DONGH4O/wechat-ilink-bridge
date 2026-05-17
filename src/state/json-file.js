import { constants } from "node:fs";
import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { WxbError } from "../core/errors.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(source, destination, options = {}) {
  const retries = options.retries ?? 10;
  const retryDelayMs = options.retryDelayMs ?? 10;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code) || attempt === retries) {
        throw error;
      }
      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

export async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(filePath, defaultValue = undefined) {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT" && defaultValue !== undefined) {
      return structuredClone(defaultValue);
    }

    if (error instanceof SyntaxError) {
      throw new WxbError("STATE_JSON_INVALID", `State file is not valid JSON: ${filePath}`, {
        retryable: false,
        details: {
          filePath,
          recoveryHint: "Move the corrupted state file aside, then run wxb login again or restore the file from a known-good backup."
        }
      });
    }

    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const handle = await open(tempPath, "w");

  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await renameWithRetry(tempPath, filePath);
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Ignore close errors while preserving the original failure.
    }
    await rm(tempPath, { force: true });
    throw error;
  }
}
