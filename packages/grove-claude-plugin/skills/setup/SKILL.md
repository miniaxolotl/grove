---
name: setup
description: Connect this Claude Code installation to a Grove account and verify memory access.
disable-model-invocation: true
---

Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" connect claude` from the user's project.
Grove Cloud is the default; add `--url <API origin>` for Grove Open Source.
The command opens browser sign-in and contextual access approval, waits for the user,
links the project and finishes setup. Repeat it after interruption to resume.
Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.js" status --client claude --json` and verify
the account, endpoint and effective capabilities. Never ask the user to paste credentials
into chat. Report awaiting sign-in/grant until remote status confirms usable access.
Ask the user to run `/reload-plugins` in Claude Code or start a new session, then
verify a user-requested memory recall. API verification alone does not confirm
that this session has loaded Grove's tools.
