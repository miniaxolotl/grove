# Grove Cloud agent connection

This page describes **terminal/coding-agent setup**. For ChatGPT and Claude web,
use the [browser-only hosted-chat flow](hosted-chat.md): remote OAuth sign-in,
explicit approval in Connections, then return/retry in the host. Hosted clients
do not run `/v1/connect`, a loopback callback or a native installer.

`npx @miniaxolotl/grove connect opencode` (or `claude`, `codex`) is the Cloud setup
entry point. `/install` presents the agent picker first; `/self-host` documents
Grove Open Source. Both use the same authenticated API and native integrations.

Run `npx @miniaxolotl/grove connect` to detect a single installed agent or choose
among installed agents in an interactive terminal. An installed `grove` command
also starts this guide when run without arguments in a terminal; `--help` displays
usage. Scripts can choose the agent explicitly and use `--json`. No separate
account-creation command is needed: the browser offers account creation and sign-in
and returns to the pending setup. Fresh `grove login` defaults to Cloud.

## Journey and boundaries

1. The CLI checks that the selected agent is installed and derives the current Git
   repository identity. Credentials in remote URLs are stripped; local-only Git
   directories use a stable hash. Non-Git directories use personal scope.
2. It reuses stored origin/agent/account credentials or runs Clerk PKCE authorization
   with `openid offline_access` and the exact `/mcp` resource audience. Tokens stay
   in the existing 0600 credential store. OAuth identity alone has no memory access.
3. `POST /v1/connect` accepts `{agent, project: {name, identity} | null}`. One request
   lives on the connection's RLS-protected `setup` column; another project receives
   an in-progress conflict until the pending request ends. The response includes a ten-minute expiry, proposed grant, state, project ID,
   client/connection IDs, and an approval URL containing only the attempt UUID.
4. The loopback OAuth callback redirects the same browser to `/app/connect/:id`.
   Clerk preserves this destination through website sign-in/sign-up. The page shows
   the agent, repository and proposed access. Defaults for a new connection are
   read/write, personal + current project, no deletion. Existing grants
   are preserved when adding a project. Customization exposes name, actions,
   selected/all projects and optional expiry.
5. Owner-session `POST /v1/connect/:id/approve` takes the grant plus `currentProject`.
   It validates ownership, expiry and scopes, links/creates the account's project,
   and writes the grant in one transaction. Agents cannot approve. Repeated approval
   never reapplies old permissions. Cancellation changes only the request, not an
   existing grant. Manual grant edits and revocation clear the request.
6. The CLI polls authenticated request status, verifies account/connection/grant,
   performs a bounded query-free recall when read access is granted (without printing
   returned memories), selects the stored origin and installs the integration. It
   reports connected only after integration configuration succeeds. Existing compatible
   native installations and unchanged OpenCode configuration are reused. OpenCode V2
   watches its configuration; Claude can use `/reload-plugins`; Codex receives restart
   and optional-hook guidance. `hostVerified: false` distinguishes API verification
   from loading tools in the host; `nextStep` provides the appropriate activation action.
   Host-loaded tools and capture still need the first-memory walkthrough.
   Native reuse is checked against the plugin versions embedded from the release
   manifests; older installs are refreshed, and incomplete/disabled installs report
   a resumable setup error. Publish the coordinated plugin versions with the CLI.
   A running bridge resolves current credentials/origin on each call, so first
   login and explicit endpoint changes take effect without restarting that bridge.

## Resume and errors

- Pending requests for the same agent/project reuse their link until expiry.
- Temporary polling failures reconnect with bounded backoff within the approval
  deadline. Revocation, cancellation and authorization errors remain terminal.
  Browser state is rechecked while pending and on focus, including at expiry;
  optional project-list failures do not block default approval. Connections routes
  pending users into the same contextual approval instead of a generic grant edit.
- Approved requests reuse the chosen scope, including deliberately excluding the
  current project. Existing usable grants need no browser approval. Expired or
  cancelled requests can be replaced by rerunning the same command.
- Requests are account-bound; another account or agent cannot read or approve them.
  Account changes, revocation, provider errors and failed installers never produce
  a successful connection result. Install failure leaves approval reusable.
- CLI approval waiting is bounded to ten minutes. `--no-browser` prints URLs; OAuth
  still needs the loopback callback on the CLI machine. It is not a device-code flow.
- Browser account creation/sign-in has a ten-minute callback window. Saved credentials
  are selected per agent and origin, including when Cloud and self-hosted editions
  are used on the same machine. Explicit URL/environment overrides take precedence.
- API keys can reuse their existing scope but cannot widen it. Paired environment
  credentials require launching the agent with the same environment. A stored key
  is not silently replaced by OAuth when it becomes invalid.
- `--json` sends a single result to stdout; progress/native installers use stderr.
  `recallVerified` distinguishes an actual read from grant-only verification when
  the user deliberately deselects read access.
- Website agent choice is remembered locally across installation and dashboard
  entry points; fresh website signup defaults to Connections, while an explicit
  pending-approval destination takes precedence. The homepage starts at installation.

## Rollout

1. Apply additive owner migration `20261019_004_connection_setup`. It adds nullable
   `connections.setup` and a partial request-ID index; no grant or RLS changes.
2. Deploy the API with the new `/v1/connect` routes. Existing clients remain supported.
3. Deploy the website approval route/BFF with matching Clerk keys and `SITE_URL`.
4. Publish the CLI and the native plugin packages containing its prebuilt executable;
   update marketplace version pins through the normal release process. Coordinate
   the website's new install command with this publication. The previously published
   CLI 0.5.0 does not have `connect`.
5. In the released versions, verify fresh sign-in, browser continuation, current-project
   approval, rerun after interruption, host restart and a user-requested save/recall.
   Verify the other account cannot use the link and revocation stops the agent.

An API rollback can leave the additive column in place. Restore the previous website
instructions with an API rollback so users are not sent to unavailable setup routes.
Production rollout and package publication are separate from merging this feature PR.

## Local verification

The disposable PostgreSQL suite covers pending isolation, owner-only approval, project
creation, replay, account isolation, cancellation, expiry, replacement, manual edits,
revocation, API-key limits and narrowed-scope resume. Packed executables exercise
PKCE/state validation, same-tab approval redirect, polling and credential reuse.
Browser tests cover selected-agent commands, approval customization/retry, ended
requests, wrong-account handling and desktop/mobile accessibility. See
[verification commands](development/testing.md).

Verified locally on 2026-10-19: 23 database/auth/client/recovery checks, 4 packed
artifact checks on both Node 24 and Node 22, 21 browser/accessibility checks, 5
deployment-script checks, root/website type checks and lint, production builds,
and the Docker image build. Desktop/mobile approval and Cloud setup were visually
reviewed. Claude Code 2.1.304 and Codex CLI 0.163.0 successfully added the published
marketplace and installed its plugin twice in isolated homes. These native checks
exercise installer repeatability with the currently published plugin, not a new
release. OAuth continuation is exercised against the test issuer; the released
production flow still needs the rollout smoke test above.

The seamless-onboarding follow-up passed 25 database/auth/client/recovery checks,
5 packed-artifact checks on Node 24 and 22, 24 browser/accessibility checks, and
root/website lint, type checks and production builds. An interactive terminal
probe covered agent selection and invalid-choice recovery. Fresh Claude 2.1.304
and Codex 0.163.0 installs followed by no-op retries passed in isolated homes using
published plugins. Packed bridge tests verify login and endpoint switching within
one running MCP process. At 320×640, the default approval action now starts around
y=532 and fits in the first viewport (previously y=949); desktop/mobile renders
were visually reviewed. Browser tests also cover storage-disabled selection,
temporary polling failures, optional project-list failure and approval in another tab.
