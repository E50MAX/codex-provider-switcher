# Changelog

## 2.0.0

- Removed all hard-coded provider addresses and HTTP headers.
- Enforced HTTPS-only Base URLs and explicit host confirmation.
- Bound DPAPI-encrypted keys to the selected Base URL.
- Added a configuration-integrity check before key decryption.
- Removed code that modified the official OpenAI Codex extension.
- Removed the custom model-catalog patch.
- Replaced `ExecutionPolicy Bypass` with process-scoped `RemoteSigned`.
- Added a command to delete locally stored API keys.
- Added security, privacy, packaging allowlist, and automated tests.
