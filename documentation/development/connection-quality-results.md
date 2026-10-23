# Connection quality verification

## Scope and status

This work tightens automatic note/notebook connections and notebook cleanup using
specific source-backed bridges, explicit abstention and policy-versioned derived
assessments. It does not add external enrichment or cross-notebook note discovery.
Implementation is in progress; this document is not production acceptance.

## Historical synthetic baseline

An ignored local report for source `6ab8fad` records **30/38** supplied-pair label
matches using the old policy. Eight expected abstentions were positive links:
film review template, ice/template-only recipes, rejected gin variant, generic
perfume praise, missing perfume attributes, place homonyms, notebook category and
project-only overlap. These reconstruct failure patterns, not original personal
notes. Missing historical usage/cost data is not inferred.

The original corpus has been inspected during development, including cases marked
held-out. Those split labels are historical partitions, not evidence of an unseen
final evaluation set. Supplied-pair results do not measure discovery recall.

## Deterministic discovery observations

The current text-only database fixture nominates **18/18 labelled positive note
pairs**, each within its own notebook among eight template distractors. It uses
the real lexical query and bounded candidate selection, without embeddings or a
generation provider. This small fixture does not establish notebook recall,
semantic classification accuracy, or recall under a saturated 32-row shortlist.

## Remaining qualification

- Finish bounded notebook selection/ranking and adversarial candidate fixtures.
- Verify policy cutover, worker/cleanup races, RLS, recovery and final-source gates.
- Agree provider/model, actual-request/token/spend limits and semantic targets
  before another paid evaluation. Freeze an independent evaluation set; report
  exact counts, errors, explanation support and usage separately from retrieval.
- Record final verification and its source identity before PR readiness.

No current-policy live accuracy result is available. The prior current-policy
output file was empty, not a successful run. Repeated synthetic runs are not
independent labelled examples or a general production accuracy estimate.

## Rollout boundary

There is no new SQL migration. Matching API/worker versions require a coordinated
pause/drain of old enrichment consumers; profile separation alone cannot prevent
arbitrary old binaries overwriting canonical pairs. See
[rollout](../deploy.md#connection-quality-policy-cutover). No production notes,
backfill, migration or deployment are part of local verification.
