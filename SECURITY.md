# Security Policy

## Supported Versions

This project is currently a pre-release source preview. Security fixes target the latest `main` branch until the first stable release is published.

## Reporting a Vulnerability

Please do not open public issues containing tokens, context tokens, QR payloads, CDN signed URLs, AES keys, local state files, or live protocol captures.

Report sensitive vulnerabilities privately through GitHub Security Advisories for `DONGH4O/wechat-ilink-bridge` when available. If advisories are not enabled yet, open a minimal public issue that says a private security report is needed, without including secrets or reproduction payloads.

## Secret Handling Expectations

- Do not commit `.env`, `.env.*`, `.wxb/`, `你的真实测试状态目录/`, or `m*-*.stdout.json`.
- Do not paste complete `botToken`, `contextToken`, bearer tokens, CDN signed query strings, or AES keys into issues.
- Prefer redacted CLI JSON output and mock fixtures when filing bugs.
