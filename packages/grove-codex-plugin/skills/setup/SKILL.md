---
name: setup
description: Connect Codex to Grove and verify the account and permitted memory scopes.
---

Run this plugin's packaged `dist/cli.js` with `connect codex`, using its absolute
path so the working directory stays in the user's project. Grove Cloud is the
default; add `--url <API origin>` for Grove Open Source. The user signs in and
approves access in the browser; the command links the project and finishes setup.
Repeat after interruption to resume, and restart Codex after installation.
Then run `status --client codex --json` and check remote account/capabilities. Do not
collect credentials in chat or put them in project files. Hook support depends on the
host and user trust; explicit memory tools remain available. Never report connected
from configuration files alone.
For startup failures, run the packaged CLI with `doctor --client codex --json`;
`--probe` explicitly tests a separate bridge/API connection without saving memories.
The actual host still needs Node 22+ on PATH. Prefer saved Grove credentials when
Codex filters inherited environment variables; never forward unrelated secrets.
