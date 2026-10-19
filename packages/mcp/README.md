# Grove

Authenticated memory CLI and stdio MCP bridge. Node 22+.

```sh
npx @miniaxolotl/grove connect opencode
```

Also supports `connect claude` and `connect codex`. Run inside your project with
the agent installed. Sign in, approve access in your browser, and keep the terminal
open while Grove links your project and configures the integration. Restart the
agent when prompted. Repeat the command to resume. Grove Cloud is the default;
use `--url https://YOUR-GROVE-API` for Grove Open Source.

Use `login --key-stdin` with a scoped API key for headless setup.
`grove mcp --stdio` exposes remember, recall, memories and forget. Argument-free
invocation prints help. Credentials are stored privately in your user config.

See [installation](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
