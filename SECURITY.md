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
- explicit one-time consent before repairing the official Codex provider filter used by local history;
- explicit one-time consent before repairing the official Codex model picker's Max filter;
- path, file-type, size, marker-count, replacement-count, and post-write checks around both repairs;
- transactional writes and best-effort rollback when the shared-history repair spans two official Codex resources.

## Important limitations

The extension configures Codex, but Codex owns the actual network connection. This extension therefore does not implement certificate pinning and cannot override Codex's TLS stack.

To display ChatGPT-account and custom-API conversations in one local history list, the extension can modify the installed official Codex extension's bundled host program and one minified webview asset. The repair only changes validated provider-filtering `modelProviders` history-query parameters to empty arrays. It does not read, copy, migrate, or write Codex conversation records or its history database. This is a local visibility repair, not cloud synchronization.

When a conversation created through one provider is resumed while another provider is selected, Codex may send existing messages and context from that conversation to the currently selected provider. Users must verify the status-bar connection before continuing sensitive conversations. Shared visibility does not make providers equally trusted.

To expose a model-catalog entry's `max` reasoning level in the current Codex VS Code UI, the extension can modify one minified webview asset inside the installed official Codex extension. This is opt-in. The repair proceeds only when one known structural pattern matches exactly once, and it is refused after any unrecognized upstream change. An official Codex update replaces the modified asset; if automatic repair remains enabled, the extension checks the new version again before writing. VS Code or endpoint-security software may still report a modified extension installation. Reinstalling or updating the official Codex extension restores its original files.

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
