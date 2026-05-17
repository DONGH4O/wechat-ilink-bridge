# Release Process

> Status: M12 npm beta release path.
> Scope: This document defines the manual release path before GitHub automation exists.

## 1. Version Policy

Use semantic versioning after the first public package:

- Patch version: bug fixes, documentation corrections, packaging fixes.
- Minor version: new CLI commands, new adapter capabilities, compatible schema additions.
- Major version: breaking CLI flags, output schema changes, state layout changes without automatic migration.

Pre-release versions:

- `0.1.0-beta.0`: public source preview.
- `0.1.0-beta.1`: npm beta after P1 outbound media support.
- `0.1.0`: first stable P1 release.
- `0.2.0`: first P2 adapter or optional multimodal helper release.

Current M12 beta candidate:

- Version: `0.1.0-beta.1`.
- Package name: `@dongh4o/wechat-ilink-bridge`.
- npm scope: `@dongh4o` exists.
- License: MIT in `LICENSE`.
- Repository: `DONGH4O/wechat-ilink-bridge`.

Do not run `npm publish` until the publishing account has access to the `@dongh4o` scope and the release candidate has passed local `.tgz` install smoke. Do not publish while `package.json.private` is `true`.

## 2. Required Decisions Before Public Release

Confirm these before changing the package to publishable state:

1. npm publish permission for the existing `@dongh4o` scope.

Confirmed defaults:

- Package: `@dongh4o/wechat-ilink-bridge`.
- CLI bin: `wxb`.
- Protocol spike helper: source-only maintenance script, not a public bin.
- License: MIT.
- Repository: public GitHub repo at `DONGH4O/wechat-ilink-bridge`.

## 3. Local Release Checklist

Run from the project root:

```powershell
npm.cmd test
npm.cmd run pack:dry-run
```

Inspect the dry-run file list. The package must not include:

- `.env` or `.env.*`.
- Local state directories such as `.wxb` or `你的真实测试状态目录`.
- Real `m*-*.stdout.json` validation captures.
- `test/fixtures/raw/live-*`.
- Bot tokens, context tokens, CDN signed URLs, AES keys, or bearer values.
- `node_modules`, coverage, logs, or prior `.tgz` archives.
- Top-level real validation captures such as `m6-fetch.stdout.json` or `m8-image-fetch.stdout.json`.

The package should include:

- `src/`.
- `skills/`.
- `docs/`.
- `README.md`.
- `CHANGELOG.md`.
- `LICENSE`.

The package should not include `scripts/`. `scripts/protocol-spike.js` remains available in the source repository through `npm.cmd run spike`, but it is not part of the public npm package surface because it accepts raw token/context inputs for protocol calibration.

Secret audit commands for the local tree:

```powershell
rg -n --hidden --glob "!node_modules/**" --glob "!你的真实测试状态目录/**" "bot_token|context_token|Authorization: Bearer|aeskey|aes_key|encrypt_query_param|sig=|token=" .
rg -n --hidden --glob "!node_modules/**" --glob "!你的真实测试状态目录/**" "https://novac2c\.cdn\.weixin\.qq\.com|m6-.*stdout|m8-.*stdout" .
```

False positives in protocol docs are acceptable when they are literal field names or fake examples; real credentials, signed URLs, and local validation captures must not be committed or packed. Because the secret scan excludes real local state directories to avoid printing credential values, also verify the git candidate set before the first commit:

```powershell
git status --short --ignored
```

Confirm `.env*`, `.workbuddy/`, `你的真实测试状态目录/`, `m*-*.stdout.json`, `*.tgz`, and `*.log` appear only as ignored files or have been removed from the working tree.

## 4. GitHub Source Release

After M9 is complete:

1. Run a secret audit.
2. Initialize git with `main` as the default branch.
3. Commit the clean source tree.
4. Create an empty GitHub repository without README/license/gitignore templates.
5. Add `origin` and push `main`.
6. Add issue templates, security policy, and CI in a follow-up commit.

Do not push local credentials, test state, or real protocol captures.

## 5. npm Beta Release

After GitHub source release and P1 outbound media support:

1. Update `package.json`:
   - set `private` to `false`.
   - set `version` to the next beta.
   - confirm package name, license, repository, bugs, and homepage are still correct.
   - confirm the publishing account can publish to npm scope `@dongh4o`.
2. Run:

```powershell
npm.cmd test
npm.cmd run pack:dry-run
npm.cmd pack
npm.cmd install -g .\*.tgz
wxb help
wxb status --json
```

For local smoke without changing the user's global prefix, use a temporary prefix:

```powershell
$prefix="C:\tmp\wxb-m12-global"
npm.cmd install -g --prefix $prefix .\dongh4o-wechat-ilink-bridge-0.1.0-beta.1.tgz
& "$prefix\wxb.cmd" help
& "$prefix\wxb.cmd" status --json --state-dir "C:\tmp\wxb-m12-smoke-state"
```

3. Publish beta:

```powershell
npm publish --tag beta --access public
```

4. Record the result in a validation report under `docs/`.

## 6. Stable Release

Before `0.1.0`:

1. Confirm beta install feedback is resolved.
2. Confirm README install paths work from npm and source.
3. Confirm GitHub CI passes on Windows, macOS, and Linux.
4. Update `CHANGELOG.md`.
5. Tag the release.
6. Publish npm stable.
7. Create a GitHub Release with the changelog summary.

Stable release checklist:

```powershell
npm.cmd test
npm.cmd run pack:dry-run
npm.cmd version 0.1.0 --no-git-tag-version
npm.cmd pack
npm.cmd install -g --prefix C:\tmp\wxb-stable-global .\dongh4o-wechat-ilink-bridge-0.1.0.tgz
& C:\tmp\wxb-stable-global\wxb.cmd help
& C:\tmp\wxb-stable-global\wxb.cmd status --json --state-dir C:\tmp\wxb-stable-smoke-state
```

After the version bump and smoke pass:

```powershell
git tag v0.1.0
npm publish --access public
npm.cmd view @dongh4o/wechat-ilink-bridge@latest name version dist-tags bin --json
```

Only publish stable after GitHub Actions CI has passed on Windows, Ubuntu, macOS, and Node.js 18/20/22.
