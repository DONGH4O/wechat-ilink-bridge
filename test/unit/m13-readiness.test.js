import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub Actions CI covers M13 platform and Node matrix", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  assert.match(workflow, /name: CI/);
  assert.match(workflow, /windows-2025/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /18\.x/);
  assert.match(workflow, /20\.x/);
  assert.match(workflow, /22\.x/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm pack --dry-run/);
});

test("M13 troubleshooting docs cover stable user-facing failure modes", async () => {
  const troubleshooting = await readFile("docs/troubleshooting.md", "utf8");

  for (const phrase of [
    "is not found",
    "PowerShell blocks",
    "NO_ACCOUNT",
    "SESSION_EXPIRED",
    "NO_CONTEXT_TOKEN",
    "INVALID_CONTEXT_TOKEN",
    "MEDIA_FILE_NOT_FOUND",
    "MEDIA_TYPE_UNSUPPORTED",
    "MEDIA_FILE_TOO_LARGE",
    "STATE_JSON_INVALID",
    "Safe Debugging"
  ]) {
    assert.match(troubleshooting, new RegExp(phrase));
  }
});

test("M13 validation report records stable release gates", async () => {
  const report = await readFile("docs/m13-validation-report.md", "utf8");

  assert.match(report, /M13 P1 稳定版准备验收记录/);
  assert.match(report, /GitHub Actions CI matrix/);
  assert.match(report, /0\.1\.0-beta\.1/);
  assert.match(report, /0\.1\.0/);
  assert.match(report, /Windows、Ubuntu、macOS/);
  assert.match(report, /Node\.js 18、20、22/);
  assert.match(report, /CHANGELOG\.md/);
  assert.match(report, /npm publish --access public/);
});

test("README and release process link stable readiness guidance", async () => {
  const [readme, releaseProcess, changelog] = await Promise.all([
    readFile("README.md", "utf8"),
    readFile("docs/release-process.md", "utf8"),
    readFile("CHANGELOG.md", "utf8")
  ]);

  assert.match(readme, /稳定版准备状态/);
  assert.match(readme, /docs\/troubleshooting\.md/);
  assert.match(releaseProcess, /Stable release checklist/);
  assert.match(releaseProcess, /git tag v0\.1\.0/);
  assert.match(releaseProcess, /GitHub Actions CI/);
  assert.match(changelog, /M13 CI matrix/);
  assert.match(changelog, /troubleshooting guidance/);
});
