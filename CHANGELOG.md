# Changelog

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
