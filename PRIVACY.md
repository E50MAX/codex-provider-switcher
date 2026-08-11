# Privacy

The extension itself makes no network requests and collects no telemetry.

It stores the following data locally under `CODEX_HOME` (normally `~/.codex`):

- the configured HTTPS Base URL and model ID;
- a generated local model catalog derived from Codex's existing `models_cache.json`;
- optional static, non-secret HTTP headers retained from a previous local configuration (credential-bearing header names are rejected);
- an API Key encrypted with Windows DPAPI and bound to the Base URL;
- backups of `config.toml` made before changes.

When custom API mode is active, Codex sends prompts, source context, tool data, and the API Key to the provider selected by the user. Users must review and trust that provider's privacy, retention, and security policies.

Codex stores a Provider on each thread. The extension does not rewrite that database metadata. With explicit consent, its old-thread takeover repair uses the local App Server's read-only `config/read` and `model/list` methods to resolve a compatible Provider, model, reasoning effort, and service tier immediately before resume. In account mode, it also uses `account/read` with `refreshToken: false` and checks only that the returned account type is ChatGPT. It does not compare or store the account's email or identity. It then waits for bounded transient writer-lock handoff and validates the thread identity and complete runtime selection returned while resuming the conversation. Because `thread/unsubscribe` does not immediately unload a thread, the extension does not use an unsubscribe/immediate-resume cycle to claim a selection change. A loaded runtime mismatch is unsubscribed and blocked until a clean window reload; active threads and unverifiable results are likewise blocked rather than silently routed.

Switching and validating a Provider does not itself send a model request. When the user sends the next message in an old conversation, Codex may provide retained prompts, source context, image references, and tool output from that conversation to the newly selected Provider or newly signed-in account. Users should review this disclosure before changing to a Provider or account with a different privacy or trust policy.

Local Codex history is scoped to the Windows user and `CODEX_HOME`, not to a ChatGPT identity. If the user signs out and signs in with another ChatGPT account while keeping the same `CODEX_HOME`, that account can view and continue the same shared local history. Use separate Windows users or separate `CODEX_HOME` directories when account-level history isolation is required.

No local setting, backup, or encrypted key file is included in the published VSIX.

The extension reads the local Codex model cache only to populate and validate model, reasoning, service-tier, context-window, and compaction metadata. It may reuse its previously generated and validated custom catalog if a newly signed-in account's cache does not contain the custom templates. It does not upload either file.

The optional shared-history repair does not read or write Codex's conversation database or session files. It only changes validated provider-filter parameters in two local JavaScript resources belonging to the official Codex extension. The provider-takeover repair changes one validated resume path in a local official-extension webview resource; it does not rewrite the conversation database, rollout files, image items, or context-compaction items. A `localImage` history item still depends on its referenced local file remaining accessible. Consent for shared history, old-thread Provider takeover, and Max visibility is stored separately in VS Code extension global state.
