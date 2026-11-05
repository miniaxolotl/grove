# AI service and request-load investigation — 5 November 2026

## Scope and evidence

Source: structured-document integration stacked on core `4775986c` (v1.11.14
baseline). Synthetic inputs only, current source adapters and disposable real
PostgreSQL with non-owner API/worker roles. No production notes, chats, schema,
configuration or credentials were changed. No production rollout was requested.

DigitalOcean readback shows the Grove API and worker **ACTIVE**, both using image
`sha256:23206b6ba0767019f60645015c797ef37a06145c02bbb24afc9fb38ef303646f`.
Both configure cloud models and speech; API additionally configures Exa/Tavily.
OpenAI and MiniMax credentials and feature-flag configuration are present; presence
is not provider success. Only non-secret settings/presence were emitted.

The local Doppler CLI could not read the current configuration. Provider probes
used the existing local credential inventory in process, never copied to source or
logs. Its speech/flag fields are stale relative to the live readback. Consequently,
these results establish access from this workstation, not current production
credential equality, runtime feature-flag evaluation or every replica's behavior.

## Fresh live-provider results

| Check                                        | Observed result                                                      | Duration                              |
| -------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| Qwen3-Embedding-8B on DeepInfra              | 4,096 finite dimensions                                              | 522 ms                                |
| clef-flash classification on DeepInfra       | Valid kind/topics schema                                             | 142 ms                                |
| MiniMax-M3.1-Flash organization              | Valid title/tags schema                                              | 1,343 ms                              |
| Exa search / extraction                      | Five nonempty search sources / one public page                       | 980 / 307 ms                          |
| Tavily search / extraction                   | Five nonempty search sources / one public page                       | 1,831 / 506 ms                        |
| Ask selected-note factual answer             | Ready; two generation calls; no proposal                             | 2,951 ms                              |
| Ask selected-note grouping                   | Ready; one generation call; no write                                 | 1,571 ms                              |
| Ask explicit edit request                    | Ready; two generation calls; edit proposal only                      | 2,838 ms                              |
| Ask unsupported selected-note notebook batch | Ready limitation response; one generation call; no proposal          | 1,295 ms                              |
| Durable embedding worker                     | Completed live embedding and persisted ready state                   | 475 ms                                |
| Retrieval Ask after indexing                 | Ready, one source/citation; one embedding and one generation request | 1,711 ms including exact-cache repeat |
| Exact retrieval Ask repeat                   | Ready; **zero** additional embedding or generation calls             | Included above                        |

All Ask cases left the synthetic note at revision 1. A proposal is not an applied
edit. These are actual service journeys against live models, not mocked model
responses, but they bypass production authentication/browser/deployment boundaries.

One initial retrieval probe returned `no_evidence` with zero generation calls and
one query embedding: the new note had not been indexed, and the whole-question
lexical search did not select it. Running its real durable embedding job made the
same question succeed. This is an indexing-readiness gap for newly saved content,
not evidence that MiniMax failed. Selected-note Ask already works before indexing.
Do not describe pre-index retrieval as instant or universally available.

**Unverified:** authenticated production Ask UI, production quotas/resolver and
every Ask intent; speech transcription/synthesis and the MiniMax voice runtime
flag. The live deployment enables speech, but the available local inventory has no
OpenAI speech key. No audio-provider request was sent and no speech pass is claimed.

## Writes, coalescing and batching

Existing protections found in source: exact tenant-scoped caching, single-flight
leases, seven-day note-work cache, provider backoff, bounded worker concurrency,
five-second brief/relationship coalescing and source/lifecycle/lease rechecks.
Embedding keys include source/model/profile rather than revision alone.
Classification also depends on candidate versions; organization depends on source,
kind and verification. Do not strip these dependencies merely to increase hits.

New deterministic disposable-service evidence:

- An identical partial save and its identical retry leave note/revision, account
  content/change versions and queued work unchanged. Retry receipts and admission
  accounting still write; no claim of eliminating all database writes.
- Create plus three rapid passage saves retains one future-due embedding job at
  the latest revision. Before it is due: zero provider calls. After advancing its
  durable due time and running the actual worker role: one call with **only the
  latest text**, one matching persisted vector, ready status and no pending job.
- Two concurrent edits from one base produce one committed winner and one conflict,
  not a merged or overwritten body. Untouched source remains byte-identical.

The measured reduction is four save-triggered source versions coalesced into one
embedding invocation **when none started during the burst**. This is not a claimed
75% production saving: already-running work and real workload distributions differ.
Every actual authored edit still gets its own atomic revision.

### Batching decision

Use the existing durable queue and newest-version coalescing now; do not add a
second queue, cross-tenant prompts, or provider batch submission lifecycle in this
increment. Interactive Ask must remain immediate. Coalescing removes obsolete work
entirely, whereas batching obsolete requests still pays for their computation.

Provider array-input embedding batches may later reduce HTTP overhead for bulk
imports. A future implementation needs measured backlog/latency, explicit provider
limits and price evidence, per-item accounting and failures, cancellation/erasure,
fenced leases, bounded encrypted staging/retention, and reconciliation of uncertain
remote acceptance. Mixed sources cannot weaken tenant authorization or source-version
checks. No verified provider batch discount or dollar saving is asserted here.
Generation/classification cannot simply be combined: they use different models,
schemas and dependency sets. Existing cached/coalesced paths are the safer first
reduction; production request/cost distributions remain unmeasured.
