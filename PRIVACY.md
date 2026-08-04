# Privacy

The extension itself makes no network requests and collects no telemetry.

It stores the following data locally under `CODEX_HOME` (normally `~/.codex`):

- the configured HTTPS Base URL and model ID;
- optional static, non-secret HTTP headers retained from a previous local configuration;
- an API Key encrypted with Windows DPAPI and bound to the Base URL;
- backups of `config.toml` made before changes.

When custom API mode is active, Codex sends prompts, source context, tool data, and the API Key to the provider selected by the user. Users must review and trust that provider's privacy, retention, and security policies.

No local setting, backup, or encrypted key file is included in the published VSIX.
