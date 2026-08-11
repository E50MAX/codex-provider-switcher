# Privacy

The extension itself makes no network requests and collects no telemetry.

It stores the following data locally under `CODEX_HOME` (normally `~/.codex`):

- the configured HTTPS Base URL and model ID;
- a generated local model catalog derived from Codex's existing `models_cache.json`;
- optional static, non-secret HTTP headers retained from a previous local configuration (credential-bearing header names are rejected);
- an API Key encrypted with Windows DPAPI and bound to the Base URL;
- backups of `config.toml` made before changes.

When custom API mode is active, Codex sends prompts, source context, tool data, and the API Key to the provider selected by the user. Users must review and trust that provider's privacy, retention, and security policies.

Provider selection is thread-scoped in Codex. The status bar describes the default for a new conversation and does not migrate an old conversation's `modelProvider`. The extension opens a fresh chat after each switch and does not copy old messages into it. If the user manually transfers old content to a new provider, that content is disclosed to the new provider by the user's explicit action.

No local setting, backup, or encrypted key file is included in the published VSIX.

The extension reads the local Codex model cache only to populate the model and reasoning selectors. It does not upload that cache.

The optional shared-history repair does not read or write Codex's conversation database or session files. It only changes validated provider-filter parameters in two local JavaScript resources belonging to the official Codex extension. Consent for the optional shared-history and Max visibility repairs is stored in VS Code extension global state.
