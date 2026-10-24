# Ask Grove tools

Ask Grove combines selected saved notes with optional **Web search** and **Research**.
Grove cloud supplies provider access to all accounts; users do not need provider
accounts or personal API keys. An installation must configure each provider before
it becomes available. Existing saved conversations remain readable.

## Controls and workflow

Open **Tools** in the message box:

- **Web search** — find current information online.
- **Research** — explore topics and read sources.
- **Manage notes** — edit notes and organize notebooks.

New accounts start with Web search and Manage notes enabled, Research disabled.
Choices persist per conversation. Switches update immediately, retain your draft
while saving, and return to the saved state on failure. **Refresh tools** recovers
stale or failed settings. **Use for new chats** saves account defaults with inline
confirmation. Availability is separate from preference state. The main Ask Grove
AI preference still applies. Internally, Web search uses Exa and Research uses Tavily;
those provider identifiers remain unchanged in the API and operator configuration.

Enabled means available when useful, not a call on every message. Ask Grove searches
for timely/external context and research-backed note creation. Ordinary note-only
retrieval and greetings should not trigger research. Both providers disabled means
no external research, including retries. Changing tools during a reply stops that
reply; server-side revisions reject late results even after disable/re-enable.

Web statements cite only returned URLs. **Web sources** records the tool, retrieval
date and whether the evidence is a search result or page extract. Saved-note
citations continue to open the note inspector. Research-backed note content includes
supporting Markdown links. Failed/limited research can return an explicitly
incomplete answer using available sources; no fabricated completion is shown.

Examples:

- “Research composting in small gardens and write a note with sources.”
- “Read this article and add its key points to my Gardening notebook.”
- “Create a Garden notebook and file these garden notes into it.”
- “Rename my Trip planning notebook to Japan.”
- “Move Japan inside Travel.”
- “Archive my old garden checklist.”
- “Restore the Gardening notebook.”
- “Delete these two notes.”

## Organization

Requests can create up to six notebooks, rename up to six, move up to 30 notes and
create up to three notes in one preview. Up to six existing notebooks can also move
to another notebook, a new destination or the root. A notebook cannot be renamed and
moved in the same preview; ask in two steps. New destinations may be nested. Existing
note edits/merges retain their own previews; new notes have a single content preview.
Grove writes only after **Apply changes** / **Save note** / **Apply edit**.

A notebook batch considers at most 50 current scoped notes in stable ID order, using
bounded excerpts. When the scope contains more, the preview states how many were
considered. Ask to continue with the next batch to use the recorded continuation;
Grove validates that it came from this conversation. This is not an unattended whole-library
reorganization. Ordinary date-based library ordering remains read-only.

Apply validates source versions, destination versions, notebook lifecycle and tenant
scope, then commits the batch atomically. Lost-response retries do not duplicate
notes or notebooks. Undo checks all applied versions and refuses to archive created
notebooks that acquired additional notes or children. Created items are archived,
not physically deleted; existing notes return to their original locations/content.
Disabling Manage notes prevents Apply but still permits Undo.

New notes share the account's 10,000-note limit with ordinary saves and assistance
action lists. Apply checks capacity for the complete batch; an over-limit batch
leaves its preview available and commits no changes. Edits, moves and Undo remain
available at capacity. Archived notes still count toward the limit.

Applied organization notes remain identifiable in follow-up requests, including
batches that also move existing notes. History carries bounded excerpts and the
created note IDs; retrieval checks current versions, active status and conversation
scope before using them as evidence or proposing another edit.

## Archive, restore and delete

Explicit requests produce a separate preview of up to 30 exact notes and six
non-overlapping notebook subtrees. Archive removes active items from recall; restore
can find archived or expired notes. Notebook previews show the full note/notebook
counts, including descendants. A notebook-scoped conversation cannot administer
children outside its exact scope; use an all-notebook conversation for a subtree.

The named **Archive selected items**, **Restore selected items** or **Delete selected
items** button is the commit step. Every source version and complete subtree
fingerprint is checked before applying the atomic batch. Changed notes or notebook
membership require a fresh preview. A request to organize or clean up does not
authorize deletion.

Archive/restore support version-checked Undo, preserving note lifetimes on Undo.
Undo also rejects notebook cycles or new contents in a created destination. Deleted
items are retained but hidden; **deletion has no ordinary Undo or restore**. Restoring
an archived notebook does not republish its old public links. Disabling Manage notes
blocks Apply but still allows non-destructive Undo. Retries return committed status.
Retained local drafts in selected notes/notebooks block lifecycle Apply until saved
or resolved. Cross-tab lifecycle notifications contain only IDs and prune cached
notes even when the other tab is offline.

## Operator setup

Configure on the API server only:

| Variable                      | Default / purpose                                                          |
| ----------------------------- | -------------------------------------------------------------------------- |
| `EXA_API_KEY`                 | Optional installation-owned Exa key                                        |
| `TAVILY_API_KEY`              | Optional installation-owned Tavily key                                     |
| `RESEARCH_DAILY_CALL_LIMIT`   | 20 provider calls per account per UTC day                                  |
| `RESEARCH_MONTHLY_BUDGET_USD` | 100 shared estimated provider dollars per UTC month; 0 stops paid dispatch |

Use private runtime secrets, never browser/public environment variables. Hosted MCP
endpoints are fixed: `https://mcp.exa.ai/mcp` and `https://mcp.tavily.com/mcp/`.
Keys travel in headers, not URLs. Self-hosters supply server-level credentials.
The backend exposes configured availability, defaults and the daily call limit;
it never exposes keys. Tools are session-only, like Ask Grove conversations.

Only Exa Lite search/page fetch and Tavily Basic search/extract are allowlisted.
Crawl, map and provider deep-research/agent tools are not exposed. Each turn plans
at most two research operations, each extraction at most three URLs. Across retries
a turn admits at most six recorded operations. Responses are capped at 512 KiB and
evidence at 2,400 characters per source, five results per search/three per extraction.
Provider calls have a 20-second deadline within the existing interactive request
deadline. The browser polls actual progress only while a reply is pending.

Spending is reserved transactionally across API replicas before dispatch. Current
conservative reservations are $0.004 per Exa Lite search, $0.003 per Exa extraction
batch and $0.008 per Tavily Basic operation. Failed or uncertain calls retain their
reservation because the provider may have charged. Successful stored operations
are reused on reply retry. These are estimates, not invoice totals; credits, price
changes, model tokens and hosting are separate. Provider billing caps also apply.
Review the configured limits and current provider rates before activating production.

Search topics/URLs go to the selected provider. Instructions limit queries to the
necessary topic rather than full private notes/transcripts. Page content is untrusted
evidence, not authority to write or invoke tools. Only public HTTP(S) source URLs
are accepted. No cross-account response cache is used.

## Data and API

Tool names, descriptions and defaults have one dependency-free catalog in
`lib/shared/src/ask-tools.ts`. Note retrieval and organization use the same
conversation-scope helper; notebook writes reuse existing domain services inside
the batch transaction. Browser progress derives from one activity formatter.

Migration `20261023_020_ask_tools` adds account defaults, conversation tool revisions,
per-turn execution records and isolated account/global usage counters. Apply it
with the owner procedure before rolling out API/worker, then website. Numbering
leaves the concurrently reserved 017–019 media migrations available; reconcile the
final release's migration list rather than assuming absent numbers must exist.

- `GET /v1/ask-tools`: availability, account defaults and daily allowance.
- `PATCH /v1/conversations/:id/tools`: `{ tools: { exa, tavily, organize }, expectedVersion, saveDefault? }`.
- Conversation reads include tool settings/revision and redacted per-turn activity.
- Replies add `webStatements`, `webSources`, `researchIncomplete` and optional
  `organization` and `lifecycle`; existing note `proposal` semantics remain intact.
- Organization adds optional `notebookMoves`; lifecycle contains the action, exact
  note/notebook refs and server-calculated subtree previews. Existing turn Apply/Undo
  endpoints handle these actions; deletion rejects Undo with `not_undoable`.

Account export includes conversation choices, web citations, authoritative batch
results and an `ask_settings` record. Private evidence follows conversation ownership
and retained-deletion visibility. Recovery preserves current defaults/settings and
conservative spending, invalidates proposals and clears resumable tool executions.
It never automatically reruns paid calls from a backup.

Note-management expansion requires no schema migration. Deploy matching API and
website code together; restored lifecycle previews/Undo are invalidated like other
conversation actions. Agent MCP tools use the same domain operations but retain
their connection grants; notebook subtree administration remains session-owner only.

Verification: deterministic MCP transport fixtures, real PostgreSQL/RLS, populated
upgrade, concurrency/cancellation/retry, atomic batch/Undo and recovery tests. Live
synthetic searches/extractions verify both actual hosted MCP contracts. Screenshots
and exact verification evidence are linked from [delivery](delivery.md).

Generation schemas are narrowed by intent and available evidence. Omitted empty
batch arrays normalize to empty; a notebook without a parent is a root notebook.
Incomplete writes and invented citations are rejected. Batch status/descriptions
come from Grove's validated operations, so model wording cannot claim unapplied
notebook changes already happened. Invalid model responses remain retryable errors.
