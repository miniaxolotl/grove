# Stage a selective release PR locally

Use the retained offline writer to inspect the **files** a selective proposal would
change. It is not connected to Source Release, publication or deployment. The normal
[pipeline](../pipeline-conventions.md#grove-release-flow) uses one coordinated
Release Please configuration and publishes all five packages together.

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

**Rollout boundary.** Do not apply this overlay to a normal release PR. The publisher
requires all five package versions to match the product; selective publication is
not supported. A local overlay authorizes no registry, provider or store writes.

Fetch the prior product tag and its history. Product releases must advance by one patch unless a matching higher `Release-As` decision appears in merged first-parent history since that tag. The proposal’s own message is not intent. Every target must carry a successful observation and its evidence reference; an inactive deployment, missing asset digest or mismatched registry tag blocks staging.

With the planner and writer together on the v1.11.24 baseline and a warm offline pnpm store, run `node scripts/release/selected-replay.mjs` from the repository root. It builds and stages two consecutive website-only releases in a disposable clone, updating only the simulated website receipt between releases.

## Opt in to website / hosted-service delivery

This hosted opt-in path is retired. Do not create `scripts/release/decision.json`
or a manifest-only PR to select release destinations. Normal releases never read
that file and do not skip packages, downloads, the backend or the website.
The retained validator and comparison helpers support offline historical replay only.

### Promotion, delivery and recovery

Follow the coordinated [deployment procedure](../deploy.md#release-and-rollout).
Its exact-source, schema, integrity and retry safeguards replace selective delivery
admission. Historical behavior is preserved in the
[v1.11.37 guide](https://github.com/miniaxolotl/grove/blob/v1.11.37/documentation/development/selected-release-writer.md).
