# ChatGPT and Claude web

Connect either hosted chat to Grove's remote MCP server. No CLI, local plugin,
browser extension or API key is needed. This is the **custom-connection/private-beta
path**, not a public-directory listing. Your chat plan and workspace policy must
allow custom MCP connections; an organization administrator may need to add it.

```text
https://api.usegrove.cloud/mcp
```

For self-hosted Grove, use your own publicly reachable HTTPS API URL plus `/mcp`,
with its matching website and OAuth issuer. Do not put tokens in that URL.
See [operator prerequisites](deploy.md#identity-and-website).

## ChatGPT

1. Open [Plugins](https://chatgpt.com/plugins), then **Add → Add custom MCP server**.
   If the option is unavailable, check current [developer-mode guidance](https://developers.openai.com/api/docs/guides/developer-mode)
   and your workspace's permissions; do not purchase/change a plan just to follow
   these instructions without checking eligibility.
2. Name it **Grove**, select **Server URL**, and paste the endpoint above.
3. Select **OAuth**. Under advanced OAuth settings, use **Dynamic Client
   Registration (DCR)**, with the discovered `openid offline_access` scopes.
   Grove's current issuer does not advertise CIMD; do not select it. Review the
   risk warning, create the custom plugin, and sign in to your Grove account.
4. Approve its Grove access as described below. Then return to ChatGPT, refresh
   the connection if necessary, and select Grove in a new conversation (for example
   by typing `@`). Interface labels can change; [OpenAI's current guide](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt.md)
   is the reference for host-side controls.

## Claude web

1. Open [Customize → Connectors](https://claude.ai/customize/connectors), then
   **Add connector → Add custom connector**. Choose **Web** if asked. Team and
   Enterprise administrators may need to add the connector for their organization
   before members connect their own accounts.
2. Name it **Grove**, paste the endpoint, and continue.
3. Choose **Sign in now** and **Register automatically** (DCR). No manually copied
   client secret is needed. Add the connector and sign in to Grove.
4. Approve its Grove access below, return to Claude, retry if necessary, and enable
   Grove in the conversation's connectors menu. See [Claude's current setup guide](https://claude.com/docs/connectors/custom/add-unlisted.md)
   if your dialog has a different layout. This is separate from the
   [Claude Code plugin](client.md#claude-code).

## Approve the right connection

OAuth establishes identity, **not permission to read your notes**. You can scan the
tool catalog while approval is pending, but note tool calls remain denied.

1. Open **Grove → Settings → Connections**, using the same Grove account used in
   the host's sign-in. Click **Refresh connections** if the new entry is missing.
2. Find the pending OAuth client by its **client ID and creation time**. A tool's
   pending-approval error links the exact connection and includes its authenticated
   client ID. A user-chosen name is not proof that a connection belongs to a provider.
   If several entries are ambiguous, do not guess or approve them all.
3. Select **Approve**, name the connection, and review its permissions. New
   connections start with every permission and scope checkbox selected:
   **Read notes**, **Save and update notes**, **Delete notes**, **Personal** and
   **All current and future notebooks**. Uncheck any access you do not want before
   approving. Read-only and selected-notebook access still work. Existing grants
   retain their saved choices; notebook nesting does not inherit permissions.
4. Approve, return to the host, and retry. Website approval alone does not prove
   the host is working: complete the synthetic save/recall check below.

Approval/edit forms carry a state fingerprint checked while the connection is
locked. A newer scope edit or revocation rejects a stale save without restoring
old permissions. Close the dialog, refresh and review again; normal tool discovery
or last-contact updates do not invalidate the review.

To stop setup, cancel the host's consent flow. If an unapproved connection was
already created, revoke that exact entry in Grove; it has no note capabilities.
No approval link or client ID alone authorizes a grant. Changing accounts requires
signing in again with the intended account, not approving another account's entry.

## Check save and recall

Use a harmless example, not credentials or private information:

> Use Grove to remember this preference in my personal notes: "I prefer concise
> answers with one worked example."

Check the reported saved ID and indexing status, then start a new conversation
with Grove enabled:

> Use Grove to recall my personal preference about answers and examples.

Try the same recall in the other connected host or an existing coding-agent
integration. All use the same account's notes, subject to each connection's scope.
Use `update_memory` for partial corrections; preserve the exact ID/version and
reuse the operation ID on retries. Generic MCP saves keep the existing `api`
source label unless the caller provides another supported provenance value;
labels are not authenticated host identities.

## Permissions and limitations

- Server instructions and argument docs share the [note-writing policy](agent-note-writing.md):
  concise, focused Markdown and information-preserving complete-body edits. The
  host still chooses when to expose/call tools; this is not guaranteed automatic
  capture or a server-side readability validator. Refresh cached metadata after
  the matching API is deployed; no new connection/grant is needed for wording alone.
- The same [14-tool contract](server.md#memory-and-notebook-tools) powers remote
  MCP and packaged integrations. Tools still enforce grants on every request.
  Tool annotations and host confirmation dialogs are not permission checks.
- Hosted OAuth cannot administer account credentials, public sharing or notebook
  subtrees, or read Grove's saved chat history. A listed owner-only tool still
  refuses the call. Notebook creation needs explicitly granted all-notebook write
  access. Uncheck all-notebook access if you do not want to allow it.
- Agent-initiated saves must use `capture: automatic`; requested saves use
  `explicit`. Grove's server preferences still apply. A local coding-agent pause
  or environment variable is not a hosted-chat privacy control.
- The host chooses when to call tools. This does not install session-start hooks,
  read every conversation, capture raw transcripts or guarantee automatic recall.
- Notes returned to a host have left Grove. That host's retention/privacy policies
  apply, and revocation cannot retract already delivered text. Grove is not
  end-to-end encrypted. Deletion hides retained notes/history; it is not erasure.
- No custom embedded UI, deep-research adapter or public-directory submission is
  included. Disconnecting a host does not delete your Grove notes; revoke access
  in Grove to stop future requests.

## Troubleshooting

| Symptom                                    | Action                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| No custom connection option                | Check the actual account/workspace policy and current vendor guidance.                                                                   |
| Discovery fails before sign-in             | Verify HTTPS reachability, `/mcp`, 401 resource metadata and issuer/DCR discovery. Do not switch to anonymous access.                    |
| Signed in, but tools say approval required | Open the exact connection link, use the same Grove account, approve only the matching client, then retry. Repeated OAuth is not the fix. |
| No pending entry                           | Refresh Connections; check the account and whether OAuth finished. Do not create/copy a broad API key as a workaround.                   |
| Read works, write/delete fails             | Check the actions and notebook scope you granted. Do not grant deletion merely to enable saves.                                          |
| Revoked/expired connection                 | Start fresh authorization in the host and deliberately reapprove. Old tokens must not regain access.                                     |
| Tools changed after an update              | Refresh the host's discovered tool metadata and start a new chat.                                                                        |
| Provider unavailable                       | Retry later; an outage is not an approved/connected state.                                                                               |

Never paste access tokens, client secrets or private notes into support reports.
Use the [support page](https://usegrove.cloud/support) with a sanitized error,
host/date and request ID if available.

## Verification and release status

Source work reuses existing OAuth/grants and requires no migration or new secret.
Deploy the matching admitted API before the website instructions through the normal
release path; merging source does not deploy it. Public listings remain separate.

| Layer                                  | Evidence / limit                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local HTTP + official MCP SDK          | Disposable PostgreSQL/non-owner-role tests cover pending scan, denied content, exact-client guidance, owner approval, two-client recall, retries/correction, read-only and revocation. |
| Real ChatGPT discovery, 24 Oct 2026    | Current public endpoint's issuer, scopes/resource and DCR were discovered; CIMD correctly unavailable. No new host connection was created.                                             |
| Real Claude discovery, 24 Oct 2026     | Current public endpoint detected OAuth sign-in and automatic DCR registration. No new connector was added.                                                                             |
| Current-release full acceptance matrix | Requires authorized fresh sign-in/save/recall/refresh/expiry/revocation in both hosts. Historical bounded checks below do not qualify every release or the complete matrix.            |

The discovery rows above describe the initial pre-authorization checks. Later
production **1.11.3** tests completed actual hosted OAuth and synthetic note
operations: both hosts denied note content before separate Grove approval;
ChatGPT saved, recalled in a fresh chat, inspected, corrected and soft-deleted one
synthetic note; Claude read that same correction and exercised its own synthetic
save/update/history and owner-only denial. ChatGPT also verified read-only,
notebook-scope and revoked-connection denials. These bounded results do not claim
an exhaustive refresh/expiry matrix or directory approval.
[Reviewer evidence and recording](https://github.com/miniaxolotl/grove/blob/92fc224d85ee6e93f540c1a0893abd239a0ec951/documentation/design/review/hosted-chat/README.md).

For local verification, run `directory.test.ts` without a database, then
`hosted-chat.test.ts`, `connect.test.ts` and `memory-tools.test.ts` with
[disposable non-owner roles](development/testing.md). Verify pending discovery,
owner-only approval, exact connection/state fingerprints, two-client access,
scope denial, retry identity and revocation. Public domain proof must not grant
account access or call identity/database services.

After the website build, `hosted-chat.spec.ts`, `connect.spec.ts` and
`playwright.hosted-chat-webkit.config.ts` cover manual endpoint-copy fallback,
pending-client refresh, narrowed approval/retry and desktop/phone accessibility.
Local fixtures are not the real-host matrix above. The
[reviewed gallery](design/screenshots/hosted-chat/README.md) and
[historical ledger](archive/README.md) preserve source-specific outcomes.

## Official directory submissions

The last recorded submission readback for OpenAI's **1.11.3** package was **In
review**, not approved or published. Recheck the portal before claiming current
status. The recorded Claude draft was held for written clarification of
[Software Directory Policy §1.G](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
for explicitly requested external preference notes and cross-session recall.
Do not claim a policy exception or submit a false compliance acknowledgement.
Until a listing is published, use the custom-connection paths above.
Review each directory's current eligibility and submission requirements. Prepare descriptions/icons, privacy and
support URLs, representative prompts, a synthetic reviewer account and repeatable
OAuth/permissions tests. Evaluate stable client registration for scale rather than
assuming the issuer supports CIMD. Submission, publication, provider changes,
embedded UI and deep-research adapters remain distinct decisions. Operators can
serve OpenAI's public domain proof with the [optional API configuration](server.md#directory-domain-verification);
this does not authorize note access or satisfy the real-host/reviewer test gates.

The metadata follow-up publishes each existing tool's human-readable title both
at the top level and in `annotations.title`, and keeps each description focused
on its own operation rather than recommending another tool. Names, schemas,
execution, safety annotations and owner-only authorization do not change. Deploy
the admitted source before reconnecting/rescanning the existing directory drafts;
a metadata fix is not policy clearance or permission to create duplicate listings.
