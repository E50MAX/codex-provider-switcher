# Changelog

## 2.2.1

- Fixed provider-switch routing ambiguity: after reload, the extension now opens a fresh official Codex chat bound by the new default provider.
- Relabeled the status bar and switch menu as the connection for **new conversations**; shared history no longer implies that an old thread's `modelProvider` was migrated.
- Added an immediate real-switch action after saving custom API settings.
- Refused activation when the legacy extension id that can claim the same commands is still installed.
- Hardened managed TOML block removal, active-provider secret checks, DPAPI file replacement, reparse-point handling, and Max-patch rollback.
- Rejected plaintext credential-bearing static headers, duplicate headers, and prototype-polluting property names.
- Added routing, activation-conflict, rollback, configuration-integrity, and credential-binding regression tests.
- Updated GitHub Actions to current Node 24-native releases pinned by immutable commit SHA.
- Replaced documentation screenshots that exposed local conversation titles with sanitized versions.

## 2.2.0

- Added a shared local history list for ChatGPT-account and custom-API conversations.
- Added an explicit-consent repair that requests all providers from the current Codex `modelProviders` history filter without reading or rewriting conversation records.
- Applied the history repair to both the extension host and webview paths with strict structural checks, post-write verification, and rollback.
- Removed the non-atomic overwrite fallback so a failed replacement leaves the existing target intact and triggers rollback.
- Added automatic revalidation after official Codex updates, a manual repair command, settings, documentation, and activation/rollback integration tests.

## 2.1.2

- Removed the decorative Logo from the README while retaining it as the extension and Marketplace icon.

## 2.1.1

- Added the supplied `Logo.png` as the extension and Marketplace icon.

## 2.1.0

- Restored a generated custom model catalog for GPT-5.6 Sol, Terra, and Luna.
- Moved custom model and reasoning selection into the official Codex composer controls.
- Removed model-ID and reasoning-effort prompts from custom API setup.
- Fixed top-level connection settings being removed on reload when the managed block was first in `config.toml`.
- Added an explicit-consent, structurally validated repair for the Codex Max reasoning option.
- Added automatic revalidation after official Codex extension updates.
- Added model-catalog and Max-repair unit tests.

## 2.0.1

- Added an explicit reasoning-effort picker with `ultra`, `max`, `xhigh`, `high`, `medium`, `low`, and `minimal` presets.
- Added a command to change and persist reasoning effort for both ChatGPT-account and custom-API modes.
- Displayed the active reasoning effort in the status-bar tooltip.

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
