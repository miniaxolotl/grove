# Grove for OpenCode V2

Prebuilt 14-tool note/notebook MCP bridge, memory skill and bounded automatic recall.
The bridge reuses OpenCode's runtime; a separate `node` on the host's PATH is not required.
Run `grove init --client opencode --url https://YOUR-GROVE-API` with the Grove CLI,
or add this package to your global `plugins` array after `grove login --client opencode`.
OpenCode reloads watched configuration automatically; check its MCP tools and
use `/reload` if Grove has not appeared. Set `private: true` in plugin options or `GROVE_PRIVATE=1` to
disable automatic context. No raw transcripts or tool logs are captured.

See [installation and scopes](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
The shared [writing policy](https://github.com/miniaxolotl/grove/blob/development/documentation/agent-note-writing.md)
guides concise, human-readable Markdown and faithful full-body edits.
