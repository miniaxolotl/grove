---
name: setup
description: Connect this Claude Code installation to a Grove account and verify memory access.
disable-model-invocation: true
---

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" login --client claude --url <API origin>`
with the user's Grove API origin. The command opens browser authorization. Have the
user complete sign-in and approve the client in Grove Connections, choosing its scope.
Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" status --client claude --json` and verify
the account, endpoint and effective capabilities. Never ask the user to paste credentials
into chat. Report awaiting sign-in/grant until the remote status confirms usable access.
