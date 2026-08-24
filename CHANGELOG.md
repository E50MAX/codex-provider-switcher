# Changelog

## 2.3.9

- Separates Provider Switcher safety-block failures from genuine App Server writer conflicts, so configuration, model-catalog, login-state, and runtime-selection errors are no longer mislabeled as “open in another app.”
- Keeps the composer fail-closed for both error classes, shows the detailed Provider Switcher resume error in a notification, and replaces the misleading writer-conflict banner with an actionable Provider Switcher message.
- Automatically upgrades the verified v5 takeover patch and applies all three related webview changes transactionally with rollback.

## 2.3.8

- Carries the most recently used supported reasoning effort across ChatGPT-account and custom-API switches instead of restoring a stale target-specific `high` value.
- Falls back to the target connection's saved effort and then the selected model default when the recent effort is unavailable.

## 2.3.7

- Fixed custom API reconfiguration on Windows when an encrypted API key already exists. Secret rotation now uses a valid temporary backup path for atomic replacement and removes the backup afterward.
- Added regression coverage for replacing and decrypting an existing DPAPI-bound API key without leaving temporary files behind.

## 2.3.6

- Preselects the Provider persisted in the active Codex configuration instead of implying a connection default in the switcher.
- Preserves the last supported custom-API reasoning effort and otherwise uses the model's own default instead of forcing `max`.

## 2.3.5

- Supports the standalone `await` assignment emitted by newer Codex webview bundles when applying and verifying Provider takeover.
- Repairs every structurally verified split `app-initial-*` history resource, so newer Codex bundles continue to share account and custom-API history.

## 2.3.4

- Verifies the current ChatGPT login with non-refreshing `account/read` before resuming account-mode history, so logout or a failed relogin cannot silently fall through to an unusable thread.
- Validates the resumed model, reasoning effort, and service tier against the current `model/list`; compatible thread-specific choices are retained, while choices unavailable after an account or Provider change fall back to compatible current settings or the model default.
- Revalidates saved account settings against the official model cache and removes stale selections when another ChatGPT account has different model entitlements.
- Keeps a previously validated custom Sol/Terra/Luna catalog usable when a newly logged-in account's cache no longer exposes those templates, without duplicating the custom display prefix.
- Preserves model context-window metadata and leaves image, local-image, image-view, and context-compaction history payloads untouched; added regression and isolated App Server coverage for restored images and post-compaction continuation.
- Automatically upgrades structurally verified 2.3.0–2.3.3 Provider-takeover patches and continues to fail closed on incomplete catalogs or runtime selection mismatches.

## 2.3.3

- Fixed old conversations continuing to use the Provider stored in their history metadata after the user switched connections.
- Reads the effective App Server configuration with `config/read` immediately before `thread/resume`, then explicitly resumes and verifies the thread with that configuration's `model_provider`.
- Fails closed if the effective Provider cannot be read or verified, and automatically upgrades structurally verified 2.3.0–2.3.2 takeover patches.

## 2.3.2

- Fixed account-mode history falsely reporting “task is running elsewhere” when the official client omits the default `openai` Provider from resume parameters.
- Normalizes only a missing Provider to `openai`, writes the resolved value into `thread/resume`, and still verifies the Provider returned by App Server before enabling the composer.
- Automatically upgrades structurally verified 2.3.1 and 2.3.0 takeover patches, with regression coverage for the omitted account Provider and malformed Provider values.

## 2.3.1

- Fixed false “task is running elsewhere” failures while the old App Server process hands its thread writer lock to the reloaded window.
- Added a bounded 10-second retry for genuine transient writer conflicts without interrupting an active task or stealing another window's lock.
- Stopped treating `thread/unsubscribe` as an immediate unload: App Server keeps an unsubscribed thread loaded during its inactivity grace period, so a Provider mismatch now fails closed and requires a clean window reload instead of retrying inside the stale runtime.
- Automatically upgrades the structurally verified 2.3.0 takeover patch and adds regression coverage for transient, persistent, unrelated, and Provider-mismatch failures.

## 2.3.0

- Added opt-in Provider takeover for existing conversations while preserving the original thread ID and local history.
- On resume, verifies the actual App Server Provider; an idle stale runtime is unsubscribed and resumed with the selected Provider, then verified again.
- Blocks sending when a thread is active, its identity changes, unsubscribe fails, or the selected Provider cannot be proven.
- Replaced forced blank-chat creation with a required window reload, allowing new and reopened idle conversations to use the current connection.
- Added honest `Codex 当前` / `Codex 默认` status states and an explicit warning that continuing an old conversation can disclose retained context to the new Provider.
- Added structural, integration, routing, update-repair, tamper, privacy, and fail-closed regression coverage.

## 2.2.2

- Replaced Node-version-dependent filesystem fault mocks with a production transactional-write helper and deterministic in-memory rollback tests.
- Verified single-file rollback, multi-file rollback, and refusal to overwrite an externally changed file.
- Updated GitHub Actions to current Node 24-native releases pinned by immutable commit SHA.
- Carries forward the provider-routing, privacy, and credential hardening prepared for 2.2.1.

## 2.2.1

- Fixed provider-switch routing ambiguity: after reload, the extension now opens a fresh official Codex chat bound by the new default provider.
- Relabeled the status bar and switch menu as the connection for **new conversations**; shared history no longer implies that an old thread's `modelProvider` was migrated.
- Added an immediate real-switch action after saving custom API settings.
- Refused activation when the legacy extension id that can claim the same commands is still installed.
- Hardened managed TOML block removal, active-provider secret checks, DPAPI file replacement, reparse-point handling, and Max-patch rollback.
- Rejected plaintext credential-bearing static headers, duplicate headers, and prototype-polluting property names.
- Added routing, activation-conflict, rollback, configuration-integrity, and credential-binding regression tests.
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
