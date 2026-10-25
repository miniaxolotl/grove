# Models and organized memory

Grove separates three text roles. Self-hosted installations can configure each role;
Grove Cloud uses deployment-managed providers:

| Role       | Cloud provider / model              | Behavior                                                                                 |
| ---------- | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Embedding  | DeepInfra `Qwen/Qwen3-Embedding-8B` | Full **4,096 dimensions**, L2 normalized; query instruction prefix, unprefixed documents |
| Decision   | DeepInfra `Cloudflare/clef-flash`   | System One fixed choices for kind, topic, salience and candidate relationships           |
| Generation | MiniMax `MiniMax-M3.1-Flash`        | Low reasoning effort, 4,096 maximum completion tokens; validated structured results      |

DeepInfra receives query/document text for embedding and source/candidate text for
classification. MiniMax receives bounded source text for organization, relationships, summaries,
and Ask Grove conversations (including up to eight preceding completed turns).
Optional [speech](speech.md) uses separate OpenAI whisper-1/tts-1 adapters and
independent account controls (transcription off, Read aloud on for new accounts);
it does not reuse a text role's provider.
Cloud credentials are server-only. Use standard pay-as-you-go MiniMax API keys for
the public service; a MiniMax coding subscription has separate eligibility and usage
windows ([provider guidance](https://platform.minimax.io/docs/m-plan/usage-rules)).

## Self-hosted configuration

The default remains local `Xenova/all-MiniLM-L6-v2` (384 dimensions), with decision
and generation disabled. `EMBEDDING_MODE=disabled` selects text-only retrieval.
Remote outages degrade queries to text search; Grove never substitutes a different
embedding model. Configure API and worker identically.

For an installation-owned settings UI:

```sh
MODEL_ADMIN_SUBJECTS=user_YOUR_CLERK_ID
MODEL_SETTINGS_KEY=REPLACE_WITH_64_HEX_CHARACTERS
```

Generate the encryption key with `openssl rand -hex 32`. Sign in as a listed
administrator and open **Settings → AI & search**. Settings apply installation-wide,
not per account. Agent credentials and ordinary website users cannot change them.
Cloud settings are read-only and ignore stored self-hosted overrides.

Settings are AES-256-GCM encrypted in PostgreSQL. The shared encryption key stays
in the API/worker environment; preserve it with backups. Reads return empty key
fields plus `credentials` booleans. A blank submitted key retains the previous key;
`clearKeys` explicitly clears it. Changing a URL requires a newly supplied key or
explicit clearing. Save before running the per-role connection test. The API reloads
settings before requests; workers reload between batches. Updates use `expectedVersion`
to reject stale forms. Environment variables are defaults until a stored configuration
exists. To rotate the encryption key, decrypt/re-encrypt the singleton in an offline
operator procedure; replacing the environment key alone cannot decrypt existing settings.

Environment-only remote example:

```sh
EMBEDDING_MODE=remote
EMBEDDING_URL=https://api.deepinfra.com/v1/openai
EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
EMBEDDING_DIMENSIONS=4096
DEEPINFRA_API_KEY=YOUR_SERVER_KEY
DECISION_PROVIDER=system-one
GENERATION_PROVIDER=minimax
MINIMAX_API_KEY=YOUR_SERVER_KEY
```

| Variables                                                                       | Meaning                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EMBEDDING_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, `EMBEDDING_DIMENSIONS` | OpenAI-compatible `/embeddings` endpoint; explicit role key overrides the DeepInfra fallback                                                                                                                            |
| `EMBEDDING_QUERY_PREFIX`, `EMBEDDING_DOCUMENT_PREFIX`                           | Input formatting; Qwen defaults to `Instruct: Retrieve relevant personal or project memories that answer the query.\nQuery: ` for queries and an empty document prefix                                                  |
| `EMBEDDING_DISTANCE_THRESHOLD`                                                  | Maximum cosine distance; default 0.65 remote / 0.45 local; tune against representative recall examples                                                                                                                  |
| `DECISION_PROVIDER`                                                             | `disabled` or `system-one`                                                                                                                                                                                              |
| `DECISION_URL`, `DECISION_MODEL`, `DECISION_API_KEY`, `DECISION_PATH`           | Defaults: `https://api.deepinfra.com/v1`, `Cloudflare/clef-flash`, DeepInfra fallback key, `/decisions`; `/systemone` is also supported                                                                                 |
| `GENERATION_PROVIDER`                                                           | `disabled`, `minimax`, or `openai-compatible`                                                                                                                                                                           |
| `GENERATION_URL`, `GENERATION_MODEL`, `GENERATION_API_KEY`                      | Defaults: `https://api.minimax.io/v1`, `MiniMax-M3.1-Flash`, MiniMax fallback key                                                                                                                                       |
| `GENERATION_OUTPUT_FORMAT`                                                      | `tool` (one `record_result` call), `json-schema`, or `json`                                                                                                                                                             |
| `GENERATION_REASONING_EFFORT`                                                   | `low`, `medium`, `high`, or `omit` for APIs without this parameter                                                                                                                                                      |
| `GENERATION_MAX_OUTPUT_TOKENS`                                                  | Default 4096; includes reasoning when the provider counts it                                                                                                                                                            |
| `AI_DAILY_REQUEST_LIMIT`                                                        | Per-account reservation cap across roles in self-hosted/flag-off mode; default 2000. Flagged Cloud generation has its own tier cap and this guard applies separately to non-generation work; see [billing](billing.md). |
| `AI_CONCURRENCY`                                                                | Worker concurrency per process, default 4; replicas share leases and account quotas                                                                                                                                     |

Compose forwards these options. Export query/document prefix variables before starting
Compose, or configure prefixes through Model settings. API base URLs can point at
local HTTP inference servers; they are trusted installation-admin settings. Keys stay
out of browser bundles, URLs and logs. Generation APIs must support Chat Completions
and the selected structured-output/token parameters.

For cloud set `GROVE_EDITION=cloud`, `DEEPINFRA_API_KEY` and `MINIMAX_API_KEY` on both
components. Missing credentials fail startup. Initial DigitalOcean provisioning sets
this configuration; image-only updates preserve existing variables, so configure
these values explicitly for an existing installation.

## Account AI preferences

**Settings → Preferences** has sixteen independent AI controls and one Save action.
Ask Grove's per-conversation research/organization tools are configured separately
in the composer:

Drafts stay in memory while switching settings tabs. **Discard changes** returns
to saved preferences; failed saves retain edits, and a completed save keeps any
newer changes you made. Provider configuration uses the same Save/Discard feedback.

| Category         | Controls                                                                 | Required provider                                                            |
| ---------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Organization     | Titles and tags; note classification; suggested filing                   | Generation for titles/tags and filing; decision for classification           |
| Connections      | Linked notes; connected notebooks; guided cleanup                        | Generation; embeddings improve candidate discovery                           |
| Summaries        | Notebook summaries; personal summary; progress summaries; change digests | Generation                                                                   |
| Ask Grove        | Answers and writing; action lists                                        | Generation                                                                   |
| Connected agents | Automatic recall; automatic capture                                      | Existing agent integration; keyword recall works without AI providers        |
| Speech           | Recording transcription; read aloud                                      | Separately configured OpenAI speech, original/temporary storage respectively |

Classification changes a note's type only when its `autoKind` is enabled. Explicit
types and handoffs remain explicit. Disabling classification does not revert a type
already applied. Connection controls preserve saved reviews, hiding their derived
results while disabled. Summary controls distinguish notebook scope, personal scope
and task handoffs, including summaries supplied to connected agents.

Disabling a feature cancels its queued work and fences its in-flight output.
Re-enabling background text features schedules those features for active notes without resetting unrelated
jobs. Ask Grove can be disabled independently of summaries; existing conversations
remain readable, keyword search remains usable, and Undo remains available for
already-applied edits. Automatic agent controls keep explicit saves and reads usable
within the connection's approved scope.
Speech always requires a separate user action; enabling it never starts transcription
or read aloud. Accepted transcripts and original recording playback remain usable.

Feature availability is separate from the saved preference. The UI marks unavailable
features while retaining the user's choices; it does not show backend vendor names
to ordinary users. Editable operator configuration keeps its technical labels.
Availability describes configuration, not a successful provider health check or
remaining quota. See [product-copy guidance](development/product-copy.md).

`GET /v1/me` includes all sixteen booleans, `aiAvailability` and separate
`speechAvailable`. Session-only
`PATCH /v1/account/settings` accepts a non-empty partial update; omitted fields keep
their values. The website submits only changed fields. The keys are
`titlesTagsEnabled`, `classificationEnabled`, `noteConnectionsEnabled`,
`notebookConnectionsEnabled`, `notebookSummariesEnabled`, `personalSummaryEnabled`,
`progressSummariesEnabled`, `askEnabled`, `recallEnabled`, `captureEnabled`,
`filingEnabled`, `actionListsEnabled`, `digestsEnabled`, `cleanupEnabled`,
`transcriptionEnabled`, and `readAloudEnabled`.
The four assistance controls are on-demand and documented in
[notebook assistance](notebook-assistance.md). For new accounts, transcription defaults
off and Read aloud defaults on; existing saved choices are preserved.
Their separate provider, privacy, request and cache contracts are in [speech](speech.md).

For older clients, `organizeEnabled` updates the four organization/connection
controls and `summariesEnabled` updates all three summary controls plus Ask Grove.
Explicit independent fields take precedence in the same request. Legacy reads are
true when any member of the corresponding group is enabled. Migration 013 copies
each account's legacy choices into its new controls; agent choices are preserved.
Reindex and restore reconciliation honor these independent preferences.

## Organization, summaries and recall

- `remember` accepts `autoKind: true`. Explicit kinds are kept by default. Handoff
  kind and stable task ID remain explicit. `retentionDays` is independent of kind;
  handoffs default to 30 days, other notes to permanent, with a 60-day restore window.
- Enrichment exposes a generated title, topic tags, suggested kind, salience, and up
  to 30 current symmetric duplicate/complementary/conflicting relationships, with
  evidence-backed reasons. [Note and notebook connections](relationships.md) describes
  grounded assessment, coverage, review, limits and migration. Classification
  never merges, deletes, or moves a memory. Salience provides a small ranking boost
  only after lexical/semantic relevance has selected candidates.
- Library search combines text and vector matches with existing scope/status/kind/tag
  filters. `searchMode` reports hybrid or lexical degradation; pagination remains in
  stable ID order unless `updated_desc`, `updated_asc`, or `created_desc` is selected.
  Timestamp cursors preserve microseconds. Agent recall uses reciprocal-rank fusion,
  bounded by 6,000 characters.
- **Settings → Account → About you** and **Notebook options → Summarize notebook**
  show cited summaries. **Progress notes** opens handoffs by title. Each statement links to exact source
  IDs/revisions. Check status or regenerate on demand.
- **Ask Grove** normally retrieves at most 12 current authorized notes within the same 6,000
  character budget. Generation validates every citation and rechecks account,
  grant, source revisions/expiry, settings, and provider profile before returning.
  Search mode performs no generation; questions never implicitly save notes.
  Conversation generation uses bounded `proposals` and `target` arrays so providers
  can express absence without nullable-object ambiguity. Validated results become
  the public note proposal (or `null`) contract. Notebook organization uses a separate
  bounded batch proposal and up to 50 note excerpts (300 characters each), with
  explicit coverage. Exa/Tavily research supplies separately validated web citations;
  conversation tools and shared cost allowances are described in [Ask tools](ask-tools.md).
  Incomplete actions remain errors; Grove supplies preview-status wording and changes
  notes/notebooks only after explicit Apply. Organization Undo remains available when
  generation or organization is disabled.
- Workers use at most 80 recent sources / 24,000 source characters; `truncated`
  signals partial coverage. Model/prompt profiles and source revisions are retained.
  Corrections, moves, archive, deletion and expiry hide stale output immediately.
  Delayed completions recheck current sources, account content version and lease.
  Background changes are coalesced with a five-second delay.
- No-query recall can include cached, validated briefs within 60% of its character
  budget, leaving room for source memories. Hooks format these as generated reference
  data. Generation never runs synchronously on recall; query embedding has an 850 ms
  provider deadline within the existing 1.5-second automatic-hook budget.
- **Retry processing** and brief regeneration respect the relevant preference and
  are version/scope checked. Failed jobs stop after five
  attempts; exhausted daily budgets defer until the next database day (UTC in the
  supplied deployment). Token counts are provider-reported, not billing estimates.

## Profile changes, reset and rollout

The database stores unconstrained pgvector vectors with checked dimensions and a
profile foreign key. Queries filter by account/project/current revision and the exact
profile. The 4,096-dimensional path uses **exact search**: pgvector HNSW limits are
2,000 float32 or 4,000 half-precision dimensions, below the selected full profile.
Evaluate larger-account latency before adding approximate search or compression.

Profiles include model, endpoint, dimensions, normalization and formatting (or prompt
version for decisions/generation). Rotating credentials does not change profile identity.
Saving a changed profile queues active content for reprocessing. Old vectors are never
used by a different profile. Lower-dimensional Qwen profiles require re-embedding in
this implementation; no automatic truncation/backfill is performed.

Pause API/worker processes while applying `20261019_005_model_providers` after #11's
`004` migration, then deploy both updated processes: the job schema changes together
with its consumers. For environment-only
model changes, or recovery, use a checkout with dependencies installed and the same
runtime configuration plus `MIGRATION_DATABASE_URL` for the operator connection:

```sh
# Load the private environment into the shell first.
pnpm models status
pnpm models reindex
```

For the authorized unused-service reset, stop API/worker ingress, then:

```sh
pnpm models reset
pnpm models status
```

`reset` reports before/after counts, tombstones every removed memory, clears memories,
revisions, vectors, enrichments, briefs, jobs and replay results, and increments account
content versions. Accounts, projects, connections, model settings and usage totals remain.
`reindex` preserves memories and replaces derived queues/briefs. Apply identical model
configuration, restart API/worker, save a disposable memory, inspect all three processing
roles, verify a 4,096-dimensional vector, then test paraphrase recall and source invalidation.
Restore reconciliation discards derived work; reindex before reopening a recovered service.

## Verification evidence

The feature suite uses local HTTP provider fixtures and disposable real pgvector with
non-owner API/worker roles. It covers full dimensions, profile separation, structured
outputs, quotas, invalid citations, stale jobs, source invalidation, scoped access,
encrypted/masked configuration and reset counts. Browser fixtures exercise model settings,
cloud read-only controls, cited context and accessibility. See [testing](development/testing.md).

Live release checks subsequently passed on 2026-10-19 using dedicated production
credentials and synthetic source text:

- DeepInfra Qwen returned all 4,096 dimensions; Grove normalized the vectors and
  matched a paraphrase above an unrelated document. Query embedding took 251 ms
  within the 850 ms deadline.
- DeepInfra Clef returned valid kind, topic, salience and duplicate-relationship
  choices through the production decision adapter.
- MiniMax M3.1 Flash returned schema-valid titles/tags and a brief with exact source
  ID/revision citations through the production pay-as-you-go generation adapter,
  with low reasoning and structured tool output.

The user-authorized production account check subsequently completed on 2026-10-19
(2026-10-20 UTC), using the combined stack at `1188e6c`:

- API and worker were paused, runtime database sessions drained, and migrations
  `004` and `005` applied. Both components now use the same digest-pinned feature
  image; the matching website is promoted at `https://usegrove.cloud`.
- Six labelled demo memories were created through the signed-in account. All
  current stored vectors have 4,096 dimensions and unit norm within float32
  tolerance. All organization jobs completed, including opt-in preference
  classification, explicit handoff preservation, and a duplicate relationship.
- The paraphrase “How should feedback on pull requests be written?” retrieved
  the sample review convention through hybrid recall in 817 ms end to end and
  through hybrid library search. Query-free task recall included cached context.
- Personal, project and task briefs are ready with exact, scope-correct source
  citations. Editing the sample checkpoint hid the previous brief immediately;
  regenerated context reflects Wednesday at 14:00 UTC and cites revision 2.
- The final account queue is empty with no failed jobs. Cloud model settings show
  the configured providers and full dimensions while returning masked keys.

Combined-stack [CI](https://github.com/miniaxolotl/grove/actions/runs/39343596438)
and the [release-image build](https://github.com/miniaxolotl/grove/actions/runs/39343613175)
passed. PR #12 remains stacked on #11 for review; this verification did not merge
either PR or publish new npm package versions.

Provider references: [DeepInfra embeddings](https://docs.deepinfra.com/api-reference/embeddings/openai-embeddings.md),
[System One](https://docs.deepinfra.com/api-reference/decisions/systemone.md),
[MiniMax Chat Completions](https://platform.minimax.io/docs/api-reference/text-chat-openai.md),
[pgvector limits](https://github.com/pgvector/pgvector/tree/v0.8.0).
