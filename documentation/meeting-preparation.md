# Meeting preparation

**Compatibility reference for the original031 API.** The current workspace uses
[Tools → Create a brief](notebook-tools.md), with any goal, broad explicit sources
and flexible cited sections. The specialized meeting launcher/toggle described below
is no longer exposed. Retained meeting requests/schema/data remain supported; the
following describes that legacy contract, not the current five-tool experience.

Prepare a brief of relevant **Decisions**, **Previous discussions** and **Open
questions** from saved notes. This is the first notebook-workflow delivery; weekly
review, recurring delivery, study sets, gap reviews and problem matching are separate
later phases, not controls enabled by this feature.

## In the workspace

1. Enable **Settings → AI preferences → Ask Grove → Meeting preparation** and configure
   a generation provider. The new preference starts **off**, including for existing
   accounts; legacy grouped switches do not enable it. No background work is queued
   by enabling it.
2. Open **Notebook options → Prepare for a meeting**, or select up to twelve saved
   notes in Notes and use **Prepare for a meeting** in the selection toolbar.
3. Enter a meeting title, agenda/topic and optional calendar date, then choose
   **Prepare brief**. Opening or editing the form does not invoke a model. A notebook
   uses direct active, unexpired members only; sub-notebooks, unfiled notes and other
   notebooks are not silently included. Selected notes are exact ID/version pins.
4. Review the sections, source excerpts and exact-revision links. Coverage distinguishes
   eligible notes, supplied/examined evidence and cited notes. A large notebook can
   produce a useful **Partial coverage** brief; it is not an exhaustive notebook read.
   No relevant evidence yields empty sections rather than invented attendees,
   agreements, questions, dates or commitments. Previous discussions means discussions
   recorded in saved notes, **not** private Ask transcripts or calendar messages.
5. **Save brief to** chooses a destination. **Save brief** explicitly creates one
   ordinary editable note with source links and the coverage qualification; it never
   edits original notes. Same-operation retries return the original save, and **Undo**
   archives only the created note, refusing to overwrite a later edit. Saved notes
   follow ordinary note retention/export behavior, not preview expiry.

**Cancel generation** fences pending publication, even if an already-dispatched
provider subsequently completes. It cannot promise the provider stopped or incurred
no cost. **Edit meeting details** preserves the form inputs; a new submission is a
new request. Failed/uncertain enqueue retries keep their original request identity.
Refresh deliberately starts a new brief against current source revisions. Source
changes require refresh rather than silently reusing an old answer. Saving a partial
brief retains its partial-coverage warning in the created note.

For selected-note errors, return to **Edit meeting details** and remove unavailable
or excessive pins under **Selected notes** without losing the agenda. This never
switches to notebook-wide scope. Unconfirmed enqueue/save requests must be retried
with their original identity before changing the request/destination; closing a
confirmed pending preview does not itself cancel the worker job.

No calendar/attendee integration, messages to participants, implicit web research,
agent/MCP workflow access, automatic note writes or live-model accuracy guarantee is
introduced. Check generated claims against sources; exact quotes alone cannot prove
that a model paraphrased them correctly.

## API, bounds and persistence

These routes require the **owning website session** and return private/no-store
envelopes. Keys, OAuth agents and public shares cannot use them.

```json
{
  "id": "stable-operation-uuid",
  "kind": "meeting",
  "projectId": "notebook-uuid",
  "title": "Launch planning",
  "agenda": "Review rollout decisions and rollback questions",
  "meetingDate": "2026-10-30"
}
```

- `POST /v1/assistance`: the body above, or `projectId: null` with one to twelve
  distinct `sources: [{id, version}]`. Title/agenda are trimmed and bounded at
  120/1,000 characters. Date is optional, a valid `YYYY-MM-DD`. Mixed scopes, empty
  selectors and unknown fields are rejected. The request UUID binds all input;
  changing it under the same UUID conflicts.
- `GET /v1/assistance/:id`: status, version, coverage, typed `meeting` sections and
  evidence. Sources use `{id, version, quote}` with exact quotations from supplied
  revisions. The server, not the model, derives counts and validates references.
- `POST /v1/assistance/:id/cancel`: strict `{expectedVersion}` for pending meeting
  work; exact replay is idempotent. Terminal successful results cannot be cancelled.
- `POST /v1/assistance/:id/apply`: `{expectedVersion, destinationProjectId?}`;
  destination defaults to the requested notebook or Unfiled for selected-note scope.
  Unrelated cleanup actions/action edits are rejected. `undo` retains existing
  source-version/replay protection. Destination authority and storage capacity are
  rechecked independently of supporting source evidence.

Notebook retrieval ranks eligible direct members lexically using the title/agenda,
then considers at most 128 metadata candidates. It loads at most twelve note bodies
with 24,000 source characters in total, without extra embedding or planning calls.
Notebook size is not rejected; omitted evidence is reported. Explicit pins that
exceed the source budget fail before inference with `evidence_too_large`; they are
never silently dropped. Generation uses one structured call, at most four items per
section, at most two source excerpts per item, plus the existing provider response
and execution limits. No saved summary or previous assistant answer substitutes for
original evidence. This is bounded lexical retrieval, not a new semantic-search engine.

The existing enrichment lane, renewable token-fenced lease, profile/preferences,
account authority, source revisions and notebook content version guard work before
dispatch and publication. Uncited notebook edits invalidate notebook-scoped briefs
too. Disabling then re-enabling the preference cannot publish an old result. Browser
cache invalidation hides obsolete excerpts; expiry clears them even offline.

One completed generated brief uses one existing **assistance action**, not one per
source. Polling, reading, Save, Undo and durable replay do not add actions. Empty
notebooks need no model call and release their reservation. Failure/cancellation
releases user-action capacity but retains actual/uncertain provider-attempt evidence.
Current billing gates, grants and provider limits remain; no wallet/pricing change.

Forward migration **031** adds an off-by-default preference, extends the existing
forced-RLS assistance kind constraint and adds indexed preview expiry. No authored
notes/history or existing usage counters are rewritten. Preview bodies, request
agenda and temporary Undo data expire after thirty days or earlier source expiry;
bounded maintenance redacts them while retaining replay fingerprints/applied refs.
Pending work cannot publish after expiry. Account cleanup and restore retain the
existing rules; generated previews are excluded from exports, applied operation
metadata remains account-export-only and authored saved briefs export as notes.

See [rollout](deploy.md#meeting-preparation-rollout-031),
[verification](development/testing.md#meeting-preparation), and the
[reviewed captures](design/screenshots/meeting-preparation/README.md).
