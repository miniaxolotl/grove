# Stage a selective release PR locally

Use the offline writer to inspect the **files** a selective Release Please PR would change. Release Please still proposes one product tag, one root changelog and one root version. The overlay remains offline; the bounded hosted-only decision path below uses the existing root-only Release Please configuration and protected production jobs.

In a checkout containing the full Git history, use the exact commit of the reviewed, one-commit Release Please proposal and the production-advisory impact report for its **parent**:

```sh
node scripts/release/selected-writer.mjs "$PROPOSAL_SHA" impact-report.json > staged.json
jq '{candidate, proposal, directory, files, publish, deliver}' staged.json
```

`directory` contains complete replacement files relative to the **parent tree**, not the already-stamped proposal. Inspect them in a disposable checkout of `candidate`; applying them over the proposal would leave the unwanted stamps in place. Remove the scratch directory after inspection. No npm credentials, network calls or write-enabled mode are needed. To run the standalone fixtures: `node --test scripts/release/selected-writer.test.mjs`.

| Impact selection    | Product files                                                     | Installer files                                                             | Suggested publication / delivery                                                |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Website only        | Root manifest, release manifest and changelog from Release Please | None                                                                        | Website, empty npm list                                                         |
| Hosted service only | Same                                                              | None                                                                        | Hosted API/worker, empty npm list                                               |
| Installable server  | Same                                                              | `packages/api/package.json` at the next patch from its own registry version | Only `@miniaxolotl/grove-server`; hosted rollout only if independently selected |

The inventory covers all five npm manifests, both native descriptors and both marketplace pins. Each must agree with its package receipt. Unknown inputs, unsupported selections (including downloads and CLI/plugins), higher/breaking package intent, inconsistent proposals and stale candidate ancestry block staging. Per-target prerequisites, required proof and store status travel with the output. An impact report is advisory input, not fresh provider evidence.

**Rollout boundary.** The coordinated publisher checks all five versions against the product, and the extension still reads the root version. Before wiring the overlay into selected npm publication, migrate those readers and the selected publisher together. Verify download/store baselines and the pinned Chrome fallback; retain frozen tag/tree and exact-source CI admission. For website-only delivery, verify the compatible active service and exact live Vercel identity. For server publication, preflight the stamped tarball, verify registry integrity and dist-tag, and reconcile partial writes. Hosted delivery still requires schema, image digest and ACTIVE API/worker readback. A local overlay authorizes none of these writes.

Fetch the prior product tag and its history. Product releases must advance by one patch unless a matching higher `Release-As` decision appears in merged first-parent history since that tag. The proposal’s own message is not intent. Every target must carry a successful observation and its evidence reference; an inactive deployment, missing asset digest or mismatched registry tag blocks staging.

With the planner and writer together on the v1.11.24 baseline and a warm offline pnpm store, run `node scripts/release/selected-replay.mjs` from the repository root. It builds and stages two consecutive website-only releases in a disposable clone, updating only the simulated website receipt between releases.

## Opt in to website / hosted-service delivery

`scripts/release/decision.json` is optional and **not installed or activated by the tooling PR**. An owner-authored, merged development PR may add or replace it, changing only that file against the exact candidate. A stale/inherited decision holds automation; it never falls back to website-only or coordinated publication. Existing historical coordinated admissions remain separate.

Schema 1 accepts exactly these fields (no unknown fields):

| Field            | Contract                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`         | `1`                                                                                                                                                                               |
| `candidate`      | Full SHA of the development commit immediately before the manifest-only declaration                                                                                               |
| `predecessor`    | `{ "tag": "vX.Y.Z", "source": "<tag commit SHA>", "production": "<current production SHA>" }`; tag is immutable and matches the candidate root version                            |
| `deliver`        | Sorted nonempty subset of `["service", "website"]`                                                                                                                                |
| `publish`        | `[]`; no npm packages, browser ZIPs or stores may be published                                                                                                                    |
| `topology`       | `"existing"`; existing API + worker only, no checker grant or topology change                                                                                                     |
| `receipts`       | All eight destination entries in the impact ledger's `{source, identity, evidence}` format, independently reconciled from actual successful readbacks                             |
| `reviewedInputs` | Exact before/after watch-fingerprint pairs keyed by each receipt source, as in `reviewedReleaseInputs`; only manually reviewed build/provider/tool inputs, never blanket prefixes |

The declaration must be an owner-authored (`miniaxolotl`) merged same-repository development PR. It freezes content by SHA rather than embedding a new tag exception in code. Source Release rebuilds comparisons with `impact-plan.mjs`: selected hosted destinations must have changed, every other destination must be unchanged, npm stamps must match their receipts, and all watch inputs must be reconciled. Changed server/CLI/plugin packs or browser downloads **block this bounded path**. In particular, hosted runtime edits which also change the installable server are not silently admitted as hosted-only; use an independently reviewed supported publication path instead. This implementation does not enable selected npm publication.

Release Please then updates only root version, release manifest and changelog by one patch. The direct release stamp cannot alter any installer manifest, native descriptor, marketplace pin or decision byte. Any higher/breaking intent needs a separate policy decision; this path accepts patch only. No dependencies, receipts or fingerprints are automatically rewritten.

For each later release, repeat the same manifest-only declaration against its new exact candidate and predecessor. Reconcile successful destination receipts after the prior delivery; do not copy a partially failed deployment into an unchanged receipt. No code change or hardcoded next tag is needed.

### Promotion, delivery and recovery

Frozen promotion still requires published source/Release Please provenance, complete exact-source CI and identical trees. The predecessor itself must be a published Release Please source release and its same-tree protected production promotion. The new selection receipt includes the decision hash; the frozen ref must start at the declared production predecessor. A changed predecessor requires a new reviewed decision, not a moved tag/ref.

Production repeats the credential-free comparison before selected image publication. The actual image publisher carries the same decision hash into its manifest. npm publication and download attachment steps are skipped; even direct `scripts/publish.mjs` invocation on the selected source resolves the decision and has an empty package list. Website-only selection skips service image and provider deployment jobs. Service-only selection skips the Vercel write. Schema preflight, immutable source-image digests, current-production fences and provider proposal validation remain mandatory.

Fresh read-only destination checks run before selected writes. On partial failure, baseline or the completed exact-source image/site can be accepted; an unrelated digest, registry/package mismatch, pending provider acceptance or unhealthy deployment holds the retry. The existing provider reconciler owns accepted-image reuse and uncertain requests. Do not overwrite immutable artifacts, refresh the decision or create a new version merely to conceal a partial outcome.

**Hosted-provider prerequisite:** `selected-deploy.mjs` requires the provider owner's `appStateFingerprint(app)` export and `--expected-app-state <sha256>` option. The provider must bind the canonical desired spec and active/pending/in-progress generation identities at both its first read and final pre-PUT read, rejecting pending generations and drift. Without that capability the selected service branch fails closed before mutation; website-only selection does not depend on it. The release wrapper rechecks the decision hash, every destination baseline, the current production ref and desired/active spec equality on every deploy-job retry; an exact already-active spec returns without another provider command. Do not remove this prerequisite to make a job green.

Selected diagnostics use the preserved API package version and upload only API maps; unchanged CLI/plugin diagnostic releases are not published.

Verify locally with `node --test scripts/release/selected-decision.test.mjs` and the full release suite. Fixtures cover two consecutive ordinary future declarations/stamps, unchanged installer bytes, actual npm-publisher no-op, incomplete scope, review/predecessor/stamp drift and partial/retry readback. Source fixtures and green CI are not live deployment acceptance; activation and all external operations still require owner authorization.
