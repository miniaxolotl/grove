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
`grove mcp --stdio` exposes remember, recall, memories and forget. Argument-free
invocation starts guided setup in an interactive terminal; `--help` prints usage.
Credentials are stored privately in your user config, with a separate origin per agent.

See [installation](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
