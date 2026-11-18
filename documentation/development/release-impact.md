# Preview release impact

The local pilot answers **what would change for each destination?** It prints JSON. Release Please, frozen promotion, `CI Gate` and protected production Deploy still own all version and delivery decisions. No workflow consumes this report.

Use reviewed Git commits, Node 24, pnpm 10.33 and GNU tar in a disposable build environment without provider credentials. The snapshot runs the revision’s install/build code; a temporary directory is not a sandbox. Warm the pnpm store for each lockfile with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip pnpm fetch --frozen-lockfile`. If `/tmp` uses another filesystem, point `TMPDIR` at an existing scratch directory on the warm store’s filesystem. Use the same toolchain and build configuration on both sides.

```sh
node scripts/release/impact-snapshot.mjs v1.11.24 > baseline.json
node scripts/release/impact-snapshot.mjs HEAD > candidate.json
node scripts/release/impact-plan.mjs candidate.json baseline.json
bash scripts/release/impact-replay.sh
```

The default [receipt ledger](../../scripts/release/impact-receipts.json) records the last **observed successful delivery** per destination. Supply a snapshot for each distinct receipt source, not just the parent of the candidate. For a historical source comparison use `--replay candidate.json parent.json`: no provider identity is inferred. The integration replay rebuilds [#265](https://github.com/miniaxolotl/grove/pull/265) against its actual parent (website only), then changes one shared wordmark (website plus all three ZIPs).

| Destination | Comparison inputs | Before any future delivery |
| --- | --- | --- |
| Vercel website | Next.js source/config, public assets, shared library/config and documentation actually rendered by the site | Check compatible API, production alias, deployment URL and live `/release.json`. Vercel Git deployment is disabled. |
| Hosted API and worker | API runtime bundle, package manifest, Docker and DigitalOcean inputs | Check base image, production dependencies, schema and compatibility; verify both registries and ACTIVE service/worker digest. This is an input comparison, not a rebuilt image. |
| GitHub browser downloads | Verified file inventory inside Chrome, Edge and Firefox ZIPs, including root license and website fonts/wordmark | Verify stamped ZIPs and checksums. The install page’s v1.11.21 Chrome fallback is a separate reader; do not silently repoint it. A ZIP is not proof of store reservation, submission, approval or availability. |
| Five npm packages | Canonical `pnpm pack`/`npm pack` contents, including copied MCP bundles, generated skills and native plugin manifests | Name the effect on an installer; check actual package version, integrity, `latest` and marketplace pins. The installed server and hosted service are independent targets. |

Comparison builds neutralize coordinated version fields and omit the production telemetry revision. An independently edited install pin remains visible. `unchanged` carries the observed identity forward; `selected` describes changed inputs, the proposed identity and required proof. `review` means evidence is insufficient, including changed lockfiles, build or provider configuration, unknown inputs and missing baselines. For a changed npm package, `--effects effects.json` accepts `{ "npm:grove": { "baseline": "<receipt SHA>", "candidate": "<candidate SHA>", "effect": "<specific installer-facing change>" } }`. A patch proposal is advisory; breaking or higher-version intent still requires review.

Use `impact-snapshot.mjs <commit> --stamped` to compute final local archive integrities with the real version and build inputs. Compare those with the actual destination receipt; a local build without the production diagnostics configuration is not the published npm artifact. Refresh only a destination verified by provider readback. Superseded candidates, missing store history, external configuration changes and dependency uncertainty require reconciliation before enabling any skips.

Regenerate both snapshots with comparison policy 2. Native and marketplace pins are compared against their owning package, independently of the root version. npm manifest stamps must agree with that package’s receipt. Packed permissions come from the archive, including executable bits. Only named offline pilot tools are excluded; new release tooling requires review. Carry-forward requires a recorded observation with a complete website identity, ACTIVE service deployment and image digest, all six download asset digests, or npm integrity and the matching `latest` version, as applicable.
