# Grove

Authenticated memory CLI and stdio MCP bridge. Node 22+.

```sh
npx @miniaxolotl/grove connect
```

Grove detects an installed agent or offers a choice. You can also use
`connect opencode`, `connect claude` or `connect codex`. Run inside your project.
Create an account or sign in and approve access in the browser. Keep the terminal
open while Grove links your project and configures the integration, then follow
its activation step. Repeat the command to resume. Grove Cloud is the default;
use `--url https://YOUR-GROVE-API` for Grove Open Source.

Use `login --key-stdin` with a scoped API key for headless setup.
`grove mcp --stdio` exposes 14 note/notebook tools, including remember, recall,
partial edits, history and organization. Argument-free
invocation starts guided setup in an interactive terminal; `--help` prints usage.
Credentials are stored privately in your user config, with a separate origin per agent.

Run `grove doctor --client opencode|claude|codex` for offline local checks; add
`--probe` for a separate bridge initialization/full catalog scan and authenticated API read.
Neither result verifies the running host session. `--json` emits redacted layered
results; diagnosis does not install plugins, open sign-in or write memories.

See [installation](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
The shared [writing policy](https://github.com/miniaxolotl/grove/blob/development/documentation/agent-note-writing.md)
and content-argument docs guide human-readable Markdown; they do not silently rewrite notes.
