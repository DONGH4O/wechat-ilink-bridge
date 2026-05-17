import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const skillPath = path.resolve("skills", "wechat-bridge", "SKILL.md");
const apiPath = path.resolve("skills", "wechat-bridge", "references", "api.md");

async function readSkillFiles() {
  const [skill, api] = await Promise.all([
    readFile(skillPath, "utf8"),
    readFile(apiPath, "utf8")
  ]);
  return { skill, api, combined: `${skill}\n${api}` };
}

test("wechat bridge skill has valid frontmatter and required workflow", async () => {
  const { skill } = await readSkillFiles();

  assert.match(skill, /^---\nname: wechat-bridge\ndescription: .+\n---/s);
  assert.match(skill, /wxb fetch --json/);
  assert.match(skill, /wxb send --account <data\.accountId> --user <fromUserId> --text/);
  assert.match(skill, /wxb queue list --json/);
  assert.match(skill, /Do not ask the user for it, do not store it, and do not pass it manually/);
});

test("wechat bridge skill documents proactive and media boundaries", async () => {
  const { skill } = await readSkillFiles();

  assert.match(skill, /Send proactive WeChat messages only when there is a clear work reason/);
  assert.match(skill, /Only send to opaque `fromUserId` values previously returned by `wxb fetch`/);
  assert.match(skill, /do not send to WeChat nicknames, phone numbers, remarks/);
  assert.match(skill, /Aliases are local convenience labels/);
  assert.match(skill, /wxb fetch --download-media --json/);
  assert.match(skill, /attachments\[\]/);
  assert.match(skill, /CDN URLs, or signed query parameters/);
  assert.match(skill, /download\.ok/);
});

test("wechat bridge docs include required error guidance", async () => {
  const { combined } = await readSkillFiles();

  for (const code of ["NO_CONTEXT_TOKEN", "SESSION_EXPIRED", "ACCOUNT_REQUIRED", "INVALID_CONTEXT_TOKEN", "TEXT_TOO_LONG", "OUTGOING_HISTORY_WRITE_FAILED"]) {
    assert.match(combined, new RegExp(code));
  }
  assert.match(combined, /Do not blindly retry/);
  assert.match(combined, /attempts only the first queued item/);
  assert.match(combined, /Do not expect `aesKey`, CDN download URLs, or signed query parameters in stdout/);
  assert.match(combined, /Treat `attachments\[\]\.path` as the only media payload handoff/);
});

test("wechat bridge docs do not include live credential-looking examples", async () => {
  const { combined } = await readSkillFiles();

  assert.equal(/bot_secret|ctx_secret|bearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(combined), false);
  assert.equal(/ABEiM0RVZneImaq7zN3u\/w==|00112233445566778899aabbccddeeff/i.test(combined), false);
});
