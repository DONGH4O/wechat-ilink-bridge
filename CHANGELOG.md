# Changelog

All notable changes to WeChat-iLink Bridge will be documented in this file.

This project follows semantic versioning after the first public package. Pre-`0.1.0` entries track milestone builds and release-readiness work.

## Unreleased

- Added M13 CI matrix and stable-release readiness documentation.
- Added troubleshooting guidance for install, login, sending, media, state, and safe debugging.

## 0.1.0-beta.1 - 2026-05-17

- Added M10 GitHub source release readiness: source install docs, issue templates, PR template, security policy, and validation report.
- Added M11 outbound file/image sending with AES upload, optional typing status, safe CLI output, and mock protocol coverage.
- Made optional typing best-effort so typing setup or stop failures do not block text, file, or image delivery.
- Prepared the M12 npm beta package by setting `private: false`, updating the package version, and documenting beta install validation.

## 0.1.0-beta.0 - 2026-05-17

- Established the M9 local release framework for pre-GitHub and pre-npm distribution readiness.
- Updated package metadata to the first public-source preview version while keeping `private: true`.
- Added M9-M15 follow-up roadmap in `docs/next-milestones.md`.
- Added local npm package file boundary through `package.json.files`.
- Added `pack:dry-run` script for release rehearsal.
- Added MIT `LICENSE` draft and release metadata placeholders for the future GitHub repository.
- Added npm ignore rules for local state, live outputs, test fixtures, logs, and package archives.
- Planned release framework before GitHub upload; CI and automated publishing remain post-GitHub work.
- Added `docs/m9-validation-report.md` with M9 test and package dry-run results.
- Kept `wxb-spike` as a source-only maintenance script instead of a public npm bin.

## 0.0.0-m8 - 2026-05-16

- Completed P1 media download support for image, file, voice, and video inbound messages.
- Added `wxb fetch --download-media` attachment output with absolute local inbox paths.
- Added AES-128-ECB media decryption and MIME/extension inference for common media types.
- Preserved token-safe stdout by omitting context tokens, CDN URLs, signed query parameters, and AES keys.
- Updated WeChat bridge skill docs to consume `attachments[].path` as the media handoff.

## 0.0.0-m7 - 2026-05-16

- Added `wxb poll` foreground polling.
- Added `wxb heartbeat` for scheduled keepalive calls.
- Added delayed resend queue for invalid context token failures.
- Added alias management for opaque `fromUserId` values.
- Added cleanup support for local history and inbox retention.

## 0.0.0-m6 - 2026-05-16

- Completed P0 Windows stabilization.
- Verified login, accounts, status, fetch, and text send flows.
- Added recovery behavior for corrupted JSON/JSONL local state.
- Preserved local-only token and context token handling.

## 0.0.0-m0-m5 - 2026-05-16

- Established protocol spike, project skeleton, local state layer, login, account management, fetch, text send, and Agent skill documentation.
