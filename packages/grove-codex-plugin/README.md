# Grove for Codex

Install `grove@grove` from the `miniaxolotl/grove` marketplace, or use
`grove init --client codex --url https://YOUR-GROVE-API`. Includes portable manifest,
14 note/notebook tools, onboarding/memory skills, optional trusted SessionStart recall,
and complete prebuilt executables. Installation does not need lifecycle scripts.
The actual Codex host needs Node 22+ on PATH. Saved Grove credentials are recommended
when the host filters environment variables. `grove doctor --client codex --probe`
checks a separate bridge and API access, not the running session's MCP status.

Run the onboarding skill to connect, then approve scope in Grove Connections.
Hook availability varies by host/surface; explicit tools work independently.
[Guide](https://github.com/miniaxolotl/grove/blob/development/documentation/client.md).
The generated memory skill shares the [writing policy](https://github.com/miniaxolotl/grove/blob/development/documentation/agent-note-writing.md):
concise, human-readable Markdown, correct scope/kind and information-preserving edits.
