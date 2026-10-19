# Grove

Authenticated memory CLI and stdio MCP bridge. Node 22+.

```sh
grove init --client opencode --url https://YOUR-GROVE-API
grove status --client opencode --json
```

Also supports `--client claude` and `--client codex`. Complete browser sign-in and
approve scope in Grove Connections, or use `login --key-stdin` with a scoped key.
`grove mcp --stdio` exposes remember, recall, memories and forget. Argument-free
invocation prints help. Credentials are stored privately in your user config.

See [installation](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
