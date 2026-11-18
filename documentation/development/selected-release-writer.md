# Stage a selective release PR locally

Use the offline writer to inspect the **files** a selective Release Please PR would change. Release Please still proposes one product tag, one root changelog and one root version. The live writer and protected production jobs still publish the coordinated release.

In a checkout containing the full Git history, use the exact commit of the reviewed, one-commit Release Please proposal and the production-advisory impact report for its **parent**:

```sh
node scripts/release/selected-writer.mjs "$PROPOSAL_SHA" impact-report.json > staged.json
jq '{candidate, proposal, directory, files, publish, deliver}' staged.json
```

`directory` contains complete replacement files relative to the **parent tree**, not the already-stamped proposal. Inspect them in a disposable checkout of `candidate`; applying them over the proposal would leave the unwanted stamps in place. Remove the scratch directory after inspection. No npm credentials, network calls or write-enabled mode are needed. To run the standalone fixtures: `node --test scripts/release/selected-writer.test.mjs`.

| Impact selection | Product files | Installer files | Suggested publication / delivery |
| --- | --- | --- | --- |
| Website only | Root manifest, release manifest and changelog from Release Please | None | Website, empty npm list |
| Hosted service only | Same | None | Hosted API/worker, empty npm list |
| Installable server | Same | `packages/api/package.json` at the next patch from its own registry version | Only `@miniaxolotl/grove-server`; hosted rollout only if independently selected |

The inventory covers all five npm manifests, both native descriptors and both marketplace pins. Each must agree with its package receipt. Unknown inputs, unsupported selections (including downloads and CLI/plugins), higher/breaking package intent, inconsistent proposals and stale candidate ancestry block staging. Per-target prerequisites, required proof and store status travel with the output. An impact report is advisory input, not fresh provider evidence.

**Rollout boundary.** The existing publisher checks all five versions against the product, and the extension still reads the root version. Before wiring this into release creation or deployment, migrate those readers and the selected publisher together. Verify download/store baselines and the pinned Chrome fallback; retain frozen tag/tree and exact-source CI admission. For website-only delivery, verify the compatible active service and exact live Vercel identity. For server publication, preflight the stamped tarball, verify registry integrity and dist-tag, and reconcile partial writes. Hosted delivery still requires schema, image digest and ACTIVE API/worker readback. A local overlay authorizes none of these writes.
