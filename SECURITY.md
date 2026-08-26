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
- explicit one-time consent before repairing old-thread provider takeover;
- explicit one-time consent before repairing the official Codex model picker's Max filter;
- path, file-type, size, marker-count, replacement-count, and post-write checks around all repairs;
- transactional writes and best-effort rollback when the shared-history repair spans two official Codex resources.
- refusal to activate alongside the legacy extension id that can claim the same commands;
- rejection of plaintext credential-bearing static headers and ambiguous JavaScript object-property names;
- strict managed-block boundaries and an active-provider check before the DPAPI secret can be decrypted;
- reparse-point checks and atomic replacement for the encrypted secret;
- a required window reload after each provider switch, after updating the active custom endpoint or key, and after deleting the key used by the active custom Provider;
- serialization of connection commands plus compare-before-write checks that refuse to overwrite a concurrently changed `config.toml`;
- refusal before filesystem mutation in VS Code Remote windows or when the official Codex WSL execution mode is enabled;
- effective-config, complete current-model-catalog, supported OpenAI-login, same-thread identity, and runtime-selection checks before a resumed old conversation is accepted;
- bounded retries for transient writer-lock handoff, plus fail-closed handling for persistent locks, active threads, failed unsubscribe operations, and Provider-verification failures.

## Important limitations

The extension configures Codex, but Codex owns the actual network connection. This extension therefore does not implement certificate pinning and cannot override Codex's TLS stack.

The current release supports only a native Windows local VS Code window. VS Code Remote and the official `chatgpt.runCodexInWindowsSubsystemForLinux` mode can place the Codex process and `CODEX_HOME` in a different filesystem and cannot use the Windows DPAPI command emitted by this extension. Those environments are rejected before configuration directories or official-extension assets are modified.

To display ChatGPT-account and custom-API conversations in one local history list, the extension can modify the installed official Codex extension's bundled host program and one minified webview asset. The repair only changes validated provider-filtering `modelProviders` history-query parameters to empty arrays. It does not read, copy, migrate, or write Codex conversation records or its history database. This is a local visibility repair, not cloud synchronization.

Codex stores a `modelProvider` on each conversation. Shared-history repair only makes those conversations visible together and does not rewrite that database field. With separate consent, the provider-takeover repair first resolves the current working directory's effective configuration through the local App Server's read-only `config/read`, validates model capabilities with `model/list`, and for the OpenAI Provider confirms a supported ChatGPT or OpenAI API key login with `account/read` and `refreshToken: false`. Signed-out and unknown authentication types remain blocked. It retains a thread-specific model, reasoning effort, or service tier only when the current catalog supports it, then explicitly passes the compatible selection to `thread/resume`. It retries a genuine transient writer conflict for a bounded 10-second window, then validates the thread identity and complete returned runtime selection.

`thread/unsubscribe` removes the current connection's subscription but does not immediately unload the thread; App Server retains an unsubscribed thread during its inactivity grace period. The extension therefore never treats unsubscribe followed by an immediate resume as a takeover. If a successfully resumed idle thread reports another Provider, model, reasoning effort, or service tier, the repair unsubscribes this connection and fails closed so a clean window reload can create a new runtime. Active threads are not forcibly released. A persistent lock, unexpected thread identity, active runtime mismatch, failed unsubscribe, incomplete model catalog, missing supported OpenAI login, or any unverified selection remains blocked. Genuine writer conflicts keep the official conflict path, while Provider Switcher safety failures keep the composer disabled and surface a separate actionable reason.

The switch and takeover checks do not themselves send a model request. Sending the next message in an old conversation can disclose its retained messages, source code, image references, and tool output to the newly selected Provider or newly signed-in account. Users must treat the switch as an explicit change of trust boundary. Local history is scoped to the Windows user and `CODEX_HOME`, not the ChatGPT identity, so another account using the same local profile can read that shared history.

The repair does not rewrite image or context-compaction history items. Embedded image data remains part of the local rollout, while a `localImage` reference is only usable while its source file remains accessible. After compaction, the next model turn receives Codex's retained summary and active context rather than every original pre-compaction token or image. The generated custom catalog preserves upstream context-window metadata, but the extension cannot prove that a third-party Provider actually honors the advertised limit or input format.

The provider-takeover and Max repairs each modify a strictly validated minified webview resource inside the installed official Codex extension. Shared history modifies the validated extension-host bundle and one webview resource. Every repair is opt-in and is refused after an unrecognized upstream change. An official Codex update replaces modified assets; if automatic repair remains enabled, the extension checks the new version again before writing. VS Code or endpoint-security software may still report a modified extension installation. Reinstalling or updating the official Codex extension restores its original files.

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
