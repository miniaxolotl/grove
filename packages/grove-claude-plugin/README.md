# Grove for Claude Code

Install `grove@grove` from the `miniaxolotl/grove` marketplace, or use
`grove init --client claude --url https://YOUR-GROVE-API`. Includes 14 note/notebook
tools, setup/memory skills, optional SessionStart recall and complete prebuilt
executables. No lifecycle build or database installation is required.
The actual Claude host needs Node 22+ on PATH. Use `grove doctor --client claude`
for local checks, or add `--probe`; separately verify the running host's MCP status.

```text
/plugin install grove --marketplace miniaxolotl/grove
```

Run `/grove:setup` to connect. Approve scopes in Grove Connections.
[Guide](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
The generated memory skill shares the [writing policy](https://github.com/miniaxolotl/grove/blob/development/documentation/agent-note-writing.md):
concise, human-readable Markdown, correct scope/kind and information-preserving edits.
