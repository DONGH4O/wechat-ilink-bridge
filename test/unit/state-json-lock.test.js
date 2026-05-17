import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WxbError } from "../../src/core/errors.js";
import { acquireAccountLock, withAccountLock } from "../../src/state/lock.js";
import { pathExists, readJsonFile, writeJsonAtomic } from "../../src/state/json-file.js";

async function withTempDir(callback) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wxb-state-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writes JSON atomically and keeps the file parseable under concurrent writes", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "account.json");

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => writeJsonAtomic(filePath, { index, value: `v-${index}` }))
    );

    const result = await readJsonFile(filePath);
    assert.equal(typeof result.index, "number");
    assert.match(result.value, /^v-\d+$/);
  });
});

test("reports corrupted JSON state files clearly", async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, "broken.json");
    await writeFile(filePath, "{broken", "utf8");

    await assert.rejects(
      readJsonFile(filePath),
      (error) => {
        assert.equal(error.name, "WxbError");
        assert.equal(error.code, "STATE_JSON_INVALID");
        assert.match(error.details.recoveryHint, /Move the corrupted state file aside/);
        return true;
      }
    );
  });
});

test("serializes work with account lock and releases the lock file", async () => {
  await withTempDir(async (stateDir) => {
    const result = await withAccountLock(stateDir, "account-1", async () => "done");

    assert.equal(result, "done");
    assert.equal(await pathExists(path.join(stateDir, "accounts", "account-1.lock")), false);
  });
});

test("returns STATE_LOCK_TIMEOUT when a lock is already held", async () => {
  await withTempDir(async (stateDir) => {
    const lock = await acquireAccountLock(stateDir, "account-1", { timeoutMs: 20, retryDelayMs: 5 });

    try {
      await assert.rejects(
        acquireAccountLock(stateDir, "account-1", { timeoutMs: 20, retryDelayMs: 5 }),
        (error) => {
          assert.ok(error instanceof WxbError);
          assert.equal(error.code, "STATE_LOCK_TIMEOUT");
          assert.equal(error.retryable, true);
          return true;
        }
      );
    } finally {
      await lock.release();
    }
  });
});
