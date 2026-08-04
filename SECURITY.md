# Security Policy

## Threat model

This extension is designed to reduce accidental credential disclosure and common network man-in-the-middle risks.

It provides the following controls:

- HTTPS-only provider URLs;
- explicit confirmation when the destination host changes;
- Windows DPAPI encryption scoped to the current Windows user;
- cryptographic binding between the encrypted key and the configured Base URL;
- a configuration check before the key is decrypted;
- no telemetry, analytics, remote code loading, or custom updater;
- a strict VSIX file allowlist;
- no modification of the official OpenAI Codex extension.

## Important limitations

The extension configures Codex, but Codex owns the actual network connection. This extension therefore does not implement certificate pinning and cannot override Codex's TLS stack.

It cannot protect against:

- a compromised or malicious API provider;
- malware or a malicious extension running as the same Windows user;
- a malicious root certificate already trusted by Windows;
- compromise of the publisher account or development machine;
- prompts and source code intentionally sent to the configured provider.

For higher-risk environments, use a provider domain you control, short-lived and least-privilege API keys, strict spending limits, key rotation, multi-factor authentication on publisher accounts, and an independently monitored TLS endpoint. Do not disable VS Code extension signature verification.

## Reporting a vulnerability

Do not include API keys, access tokens, private endpoints, `auth.json`, `config.toml`, or encrypted key files in a public report. Revoke any credential that may have been exposed before sharing logs.

Until a public security contact is configured, report privately to the repository owner through the hosting platform's private vulnerability-reporting feature.
