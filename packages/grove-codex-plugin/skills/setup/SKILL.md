---
name: setup
description: Connect Codex to Grove and verify the account and permitted memory scopes.
---

Ask for the Grove API origin if it is not configured. Run the packaged CLI in
`dist/cli.js` with `login --client codex --url <API origin>` from this plugin's root.
The user completes browser authorization and approves scope in Grove Connections.
Then run `status --client codex --json` and check remote account/capabilities. Do not
collect credentials in chat or put them in project files. Hook support depends on the
host and user trust; explicit memory tools remain available. Never report connected
from configuration files alone.
