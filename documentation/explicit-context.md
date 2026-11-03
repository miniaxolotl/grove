# Choose sources in Ask Grove

Choose **Sources** beside the message box, or type `@note` / `@notebook` followed
by Space, Tab or Enter. Search by title or words, check the notebook path, and use
the eye button for a read-only preview. Closing a preview keeps the chooser's
search, selections and position. Choose **Done**, then write your question.

Selections are IDs, not names inferred by the model. Similar titles remain separate
choices. Select up to 12 individual notes and six notebooks. Chips can be removed;
**Add or replace sources** reopens the chooser. Removing the final chip does not
silently enable automatic retrieval: choose another source or deliberately choose
**Use automatic sources** before sending.

## Selected sources only

Adding a source initially enables **Use only these sources**. This applies to one
question, including its retries—not every later question. The question and answer
show **Selected sources only**. Earlier answers, source bodies, proposals, summaries
and external research are not supplied to either planning or answering. Enabled web
tools do not run for that question; their saved switches are not changed.

Existing chat attachments are also excluded from strict selected-source evidence.
Turn off **Use only these sources** to combine selected notes with accepted document
attachments; document-grounded questions still never dispatch external research.

The restriction controls evidence supplied by Grove. It does not guarantee that a
language model has no pretrained knowledge or will never make an unsupported claim.
Inspect the citations and ask for more evidence where necessary.

Turn off the checkbox to combine selected evidence with ordinary automatic retrieval
and enabled research tools. Without any selection, existing Ask behavior is unchanged.
The existing conversation notebook scope and account authorization always apply.

### Large notebooks and coverage

A selected notebook includes active, unexpired **direct members only**, not its
sub-notebooks. Large notebooks are supported without loading their contents into the
browser. Individually selected notes are pinned first; remaining slots are filled
inside the selected notebooks using keyword relevance, then newest-update order and
stable IDs. No unrestricted lexical/vector recall runs in strict mode. This first
version uses keyword ranking, not semantic embeddings, for notebook-local retrieval.

At most 12 complete notes are supplied for a reply (up to 72,000 note-content
characters under the existing 6,000-character note limit). Selected notes and overlapping
notebook membership are deduplicated. Notebook membership itself is not capped at 12.
If pins consume every slot, the answer explicitly states that no additional notebook
notes were provided. Narrow pins or ask a more specific question to change coverage.

**Selected scope** identifies the user's choices. Coverage records how many eligible
selected-scope notes were provided at answer time and whether that was partial.
**Provided as evidence** lists the exact available note revisions supplied to the
model; each identifies whether it was **Cited in answer** or **Provided, not cited**.
A citation is not proof that all provided notes—or the whole notebook—were read.
Later deletion can make old evidence unavailable without changing historical counts.

Do not interpret a bounded answer as an exhaustive whole-notebook summary. When
evidence is missing or irrelevant, Grove is instructed to state that limitation.
**Add sources** copies the question and selections into an editable draft and opens
the chooser. It never sends automatically or broadens the saved question. Finish or
clear an existing unsent draft first so it is not overwritten.

## Reviewed changes and recovery

An explicit request can preview an edit or merge of supplied source revisions when
**Manage notes** is enabled. Selection alone does not authorize a write. Existing
**Apply edit** / **Merge notes**, version checks and **Undo** remain required.
Selected-source questions do not discover notebook destinations, create notes or run
organization/lifecycle batches; start an ordinary question without selectors for
those operations. In strict mode every proposed edit/merge reference must come from
the selected evidence, not other notes or previous turns.

Missing, foreign, deleted, archived, expired and out-of-conversation selectors fail
before provider dispatch. An empty accessible notebook stays empty; it never falls
back to the library. A rejected question and its choices are retained separately
from any newer draft. **Edit sources** restores them with remove/replace controls;
edited input uses a new turn ID. An uncertain send or unchanged retry keeps its
original ID and selection until reconciled.

Selections and rejected inputs follow account/session-owned in-memory drafts when
switching conversations. They are not durable drafts across a full browser reload.
Saved turns retain selectors, evidence revisions and coverage for history/export.
Scope changes clear incompatible selectors; changing sources never changes an old
turn in place. Concurrent source, membership, authorization, preference or provider
changes fence publication rather than publishing stale evidence.

## API and rollout

`POST /v1/conversations/:id/turns` accepts optional:

```json
{
  "context": {
    "notes": ["00000000-0000-4000-a000-000000000011"],
    "notebooks": [],
    "only": true
  }
}
```

All three fields are required when `context` is present; arrays contain unique UUIDs,
with at least one selector overall. The turn fingerprint includes this object, so
changed selections under the same turn ID conflict. Old clients omit `context`.
Responses return it on the turn and `result.contextCoverage` with `eligible`,
`provided`, `partial`, `notebookEligible` and `notebookProvided`. Notebook counts in
the last two fields exclude individually pinned notes. Source validation returns
`context_unavailable` (409), without revealing foreign source details or advancing
the conversation. Existing source/version conflicts remain distinct.

Migration `20261025_030_conversation_context`, after search 029, adds nullable turn
metadata without changing existing rows, counters or RLS. Apply using the
[owner procedure](operations/schema.md), deploy matching API/worker before website,
and keep the additive column on rollback. Do not reserialize old turn fingerprints.
No new provider key/flag is needed. Exports retain selectors; restore invalidates
in-flight work and deleted chats rather than reviving evidence.

`conversations.test.ts` covers exact IDs, direct membership, pinned order,
partial/omitted evidence, strict history/web exclusion, reviewed Apply/Undo,
source races/retries, invalid citations and HTTP/export compatibility.
`conversation-context-migration.test.ts` checks populated pre-030 retention and
non-owner isolation. Browser checks cover picker/search/pagination, duplicate
titles/paths, @mention keyboard/IME/cancel, chips, last-selector guards, drafts,
history and unavailable-source recovery at 1440/390/320px in Chromium/WebKit.
Use [disposable fixtures](development/testing.md); synthetic results do not qualify
paid-model answer quality. See [evaluation scope](development/explicit-context-results.md).
