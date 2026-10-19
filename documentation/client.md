# Agent installation

Use Node 22+ for clients; server/development baseline is Node 24. See
[delivery evidence](delivery.md) for tested host versions and provider gates.

Hosted Grove is at [usegrove.cloud](https://usegrove.cloud), with API origin
`https://api.usegrove.cloud`. Self-hosted installations substitute their own origin.

## CLI

```sh
npm install -g @miniaxolotl/grove
grove init --client opencode --url https://api.usegrove.cloud
grove status --client opencode --json
grove project --client opencode
```

`init` signs in and installs the requested integration. Complete browser consent,
then approve the pending client in **Connections**, selecting capabilities and
personal/project scope. `project` resolves or creates the current Git repository's
identity after access is approved. A login with no grant reports `awaiting-grant`.
`status` always checks the API; stored credentials alone do not prove connectivity.

For a browser on another machine, `grove login --no-browser` prints the link
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

`grove logout --client …` revokes the connection and clears local credentials;
it reports when remote revocation could not be confirmed. `grove pause`/`resume`
control automatic hooks. `GROVE_PRIVATE=1` disables automatic recall locally.
Explicit user-directed tools remain available. Server Settings separately control
automatic recall and capture. A response already sent to a host cannot be recalled.

## OpenCode V2

`grove init --client opencode` merges only the Grove entry in the global JSON/JSONC
`plugins` array. Comments, unrelated plugins and MCP entries are preserved.

```json
{ "plugins": ["@miniaxolotl/grove-opencode-plugin"] }
```

The V2 plugin registers its packaged stdio MCP bridge, a memory skill and a bounded
context hook through the V2 APIs. It does not add a second Grove server if one is
already configured. No V1 hook or handwritten MCP transport remains. Plugin option
`private: true` or session metadata `private: true` also disables automatic recall.
Restart OpenCode after installation. `grove uninstall --client opencode` removes
only the matching plugin entry; it does not delete memories or credentials.

## Claude Code

```sh
grove init --client claude --url https://api.usegrove.cloud
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

## Codex

```sh
grove init --client codex --url https://api.usegrove.cloud
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

First run `grove login --client cli`. Argument-free `grove` prints help. The bridge
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
