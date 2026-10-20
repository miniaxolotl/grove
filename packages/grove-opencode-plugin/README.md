# Grove for OpenCode V2

Prebuilt four-tool MCP bridge, memory skill and bounded automatic recall.
Run `grove init --client opencode --url https://YOUR-GROVE-API` with the Grove CLI,
or add this package to your global `plugins` array after `grove login --client opencode`.
OpenCode reloads watched configuration automatically; check its MCP tools and
restart if Grove has not appeared. Set `private: true` in plugin options or `GROVE_PRIVATE=1` to
disable automatic context. No raw transcripts or tool logs are captured.

See [installation and scopes](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
