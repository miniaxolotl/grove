# Ask Grove tools

Ask Grove combines selected saved notes with optional Exa/Tavily web research.
Grove cloud supplies provider access to all accounts; users do not need provider
accounts or personal API keys. An installation must configure each provider before
it becomes available. Existing saved conversations remain readable.

## Controls and workflow

Open **Tools** in the message box. **Exa** searches/reads the web; **Tavily** also
searches/reads websites; **Grove** enables note and notebook changes. New accounts
start with Exa and Grove enabled, Tavily disabled. Choices persist per conversation.
**Use these tools for new chats** saves account defaults. Provider availability is
separate from preference state. The main Ask Grove AI preference still applies.

Enabled means available when useful, not a call on every message. Ask Grove searches
for timely/external context and research-backed note creation. Ordinary note-only
retrieval and greetings should not trigger research. Both providers disabled means
no external research, including retries. Changing tools during a reply stops that
reply; server-side revisions reject late results even after disable/re-enable.

Web statements cite only returned URLs. **Web sources** records provider, retrieval
date and whether the evidence is a search excerpt or page extract. Saved-note
citations continue to open the note inspector. Research-backed note content includes
supporting Markdown links. Failed/limited research can return an explicitly
incomplete answer using available sources; no fabricated completion is shown.

Examples:

- “Research composting in small gardens and write a note with sources.”
- “Read this article and add its key points to my Gardening notebook.”
- “Create a Garden notebook and file these garden notes into it.”
- “Rename my Trip planning notebook to Japan.”

## Organization

Requests can create up to six notebooks, rename up to six, move up to 30 notes and
create up to three notes in one preview. New destinations may be nested. Existing
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
Disabling organization prevents Apply but still permits Undo.

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

Migration `20261023_020_ask_tools` adds account defaults, conversation tool revisions,
per-turn execution records and isolated account/global usage counters. Apply it
with the owner procedure before rolling out API/worker, then website. Numbering
leaves the concurrently reserved 017–019 media migrations available; reconcile the
final release's migration list rather than assuming absent numbers must exist.

- `GET /v1/ask-tools`: availability, account defaults and daily allowance.
- `PATCH /v1/conversations/:id/tools`: `{ tools: { exa, tavily, organize }, expectedVersion, saveDefault? }`.
- Conversation reads include tool settings/revision and redacted per-turn activity.
- Replies add `webStatements`, `webSources`, `researchIncomplete` and optional
  `organization`; existing note `proposal` semantics remain intact.
- Existing turn Apply/Undo endpoints accept notebook batches too.

Account export includes conversation choices, web citations, authoritative batch
results and an `ask_settings` record. Private evidence follows conversation ownership
and retained-deletion visibility. Recovery preserves current defaults/settings and
conservative spending, invalidates proposals and clears resumable tool executions.
It never automatically reruns paid calls from a backup.

Verification: deterministic MCP transport fixtures, real PostgreSQL/RLS, populated
upgrade, concurrency/cancellation/retry, atomic batch/Undo and recovery tests. Live
synthetic searches/extractions verify both actual hosted MCP contracts. Screenshots
and exact verification evidence are linked from [delivery](delivery.md).
