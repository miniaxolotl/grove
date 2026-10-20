# Agent installation

Use Node 22+ for clients; server/development baseline is Node 24. See
[delivery evidence](delivery.md) for tested host versions and provider gates.

Grove Cloud is at [usegrove.cloud](https://usegrove.cloud), with API origin
`https://api.usegrove.cloud`. Grove Open Source is the self-hosted edition.

## CLI

```sh
npx @miniaxolotl/grove connect
```

Run inside your project, with your agent installed and on PATH. Grove detects a
single installed agent or offers a terminal choice. Use `connect opencode`,
`connect claude` or `connect codex` to select explicitly, including in scripts.
The command selects Cloud automatically, reuses valid credentials, and opens
account creation or sign-in if needed. The same browser continues to a contextual
approval page. Defaults are reading/saving personal and current-project memories,
with permanent deletion off; **Customize access** changes actions, scope, name or
expiry. Approval creates/links the project without granting all-project access.

Leave the terminal open. It waits up to ten minutes for approval, checks the effective
grant, performs a bounded read when permitted, and installs the native integration.
Follow the activation step: OpenCode V2 reloads watched configuration automatically,
Claude Code supports `/reload-plugins`, and Codex needs a restart. This verifies API
access; use the first-memory prompt to confirm the host has loaded Grove.
`--json` reports `recallVerified`, `restartRequired`, `hostVerified: false` and
`nextStep`; progress and native installer output go to stderr.

Repeat the same command after interruption or installation failure. Existing grants
are reused without widening them; a new project requires a new owner approval.
Cancelled or expired requests get a fresh link. Revoked OAuth connections require
fresh authorization and approval. Named API keys must already cover the project;
they cannot ask the browser to widen their own permissions.
Transient polling errors reconnect automatically. A second project cannot replace
an outstanding approval; finish or cancel it in Connections before proceeding.

For Grove Open Source, add `--url https://YOUR-GROVE-API`, or explicitly set
`GROVE_API_URL`. The API's `SITE_URL` selects your approval website. A plain `connect`
defaults to Cloud, even if another origin was configured previously. This command
requires the API/website migration described in [Cloud onboarding](cloud-onboarding.md).

For a persistent `grove` command, install `@miniaxolotl/grove` globally. Existing
`init`, `login`, `status` and `project` commands remain supported. `init` uses the
older dashboard-approval workflow; a login with no grant reports `awaiting-grant`.
`status` checks the API, not whether the host has loaded its plugin.
Running `grove` alone in a terminal starts guided setup; `grove --help` shows usage.
Fresh `login` and `init` default to Cloud when no origin is configured.

For a browser on another machine, `grove connect opencode --no-browser` prints the link
without launching a browser. The loopback callback must still reach the CLI host.

For a named, scoped headless key created in Connections:

```sh
# Supply the key via stdin from your credential manager, not a chat or argument.
grove login --client claude --url https://api.usegrove.cloud --key-stdin
```

Services may set `GROVE_API_URL` and `GROVE_API_KEY` together. Credentials are bound
to API origin, agent and account in `$XDG_CONFIG_HOME/grove` (default
`~/.config/grove`), with 0600 files and atomic replacement. `GROVE_CONFIG_HOME`
can select a dedicated installation. Never set it to a shared project directory.
The active origin is selected per agent so connecting another agent to a
self-hosted instance does not switch your Cloud agent's endpoint.

`grove logout --client …` revokes the connection and clears local credentials;
it reports when remote revocation could not be confirmed. `grove pause`/`resume`
control automatic hooks. `GROVE_PRIVATE=1` disables automatic recall locally.
Explicit user-directed tools remain available. Server Settings separately control
automatic recall and capture. A response already sent to a host cannot be recalled.

## OpenCode V2

`grove connect opencode` merges only the Grove entry in the global JSON/JSONC
`plugins` array. Comments, unrelated plugins and MCP entries are preserved.

```json
{ "plugins": ["@miniaxolotl/grove-opencode-plugin"] }
```

The V2 plugin registers its packaged stdio MCP bridge, a memory skill and a bounded
context hook through the V2 APIs. It does not add a second Grove server if one is
already configured. No V1 hook or handwritten MCP transport remains. Plugin option
`private: true` or session metadata `private: true` also disables automatic recall.
OpenCode reloads watched configuration automatically; check its MCP tools and
restart if Grove has not appeared. `grove uninstall --client opencode` removes
only the matching plugin entry; it does not delete memories or credentials.

## Claude Code

```sh
npx @miniaxolotl/grove connect claude
# Native installation alone:
claude plugin marketplace add miniaxolotl/grove
claude plugin install grove@grove --scope user
```

The npm marketplace package includes `.claude-plugin/plugin.json`, `.mcp.json`,
skills, the SessionStart hook and prebuilt executables. Run `/grove:setup` if the
connection is not configured. Hook output is structured `additionalContext`, with
a 1.5-second automatic-memory deadline. Failures leave the host usable; writes
always report their actual result. `grove uninstall --client claude` calls the
native targeted plugin uninstall.
Run `/reload-plugins` in an existing session or start a new session to load Grove.

## Codex

```sh
npx @miniaxolotl/grove connect codex
# Native installation alone:
codex plugin marketplace add miniaxolotl/grove
codex plugin add grove@grove
```

The portable package includes `plugin.json`, `mcp.json`, the OpenAI onboarding
skill, memory skill, optional SessionStart hook and prebuilt executables. It works
without npm lifecycle scripts or user compilation. Review/trust hooks in the host;
support varies by surface. CLI/plugin tools remain available without hooks. This
is a local/team marketplace package, not a submitted public-directory plugin.
`grove uninstall --client codex` calls `codex plugin remove grove@grove`.

## Other MCP clients

Use remote Streamable HTTP `https://api.usegrove.cloud/mcp` with OAuth or an API key,
or configure the local command:

```json
{ "command": "grove", "args": ["mcp", "--stdio"] }
```

First run `grove login --client cli`. `grove --help` prints help. The bridge
uses the official MCP SDK and the authenticated HTTP API. Stdout is protocol-only.

## Scope and capture

Git HTTPS/SSH origins normalize to `git:host/owner/repository`, stripping credentials,
query data and `.git`. Local-only repositories use a hash of their common Git
directory, shared across worktrees. Non-Git tasks default to personal scope.
`GROVE_PROJECT_IDENTITY` and `GROVE_PROJECT_NAME` explicitly override local identity.

Hooks retrieve a compact active profile and never persist raw chat/tool output.
Skills guide the agent to save only confirmed context. Automatic saves must set
`capture: "automatic"`; user-requested saves are explicit. Handoffs use stable task
IDs and versioned updates. Recall results are untrusted reference data, not system
instructions. No importance decay, stale-memory pruning or compaction deletion runs.
