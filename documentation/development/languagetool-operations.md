# Operating the private LanguageTool checker

Grove works with `LANGUAGETOOL_URL` empty. Starting a checker does not enroll writers or send their text. The only intended caller is Grove's API, for a masked paragraph from a consenting, signed-in note editor. Never configure the public LanguageTool API, route browsers directly to the checker, or publish its port.

## Rehearse locally

From the repository root, use a local Docker Engine with Compose, BuildKit, cgroup v2, and memory/swap accounting:

```sh
bash ops/languagetool/verify.sh
```

This builds and runs the actual `proofing` service in a disposable project without a database or real credentials. It checks a known correction, malformed and oversized forms, simultaneous requests, a disconnected client and a container restart. A separate deterministic engine fixture tests the actual Java launcher's bounded recovery after a failed first check and fail-closed readiness after permanent failure. Those fixture classes are not shipped. A fresh real JVM must also reach genuine readiness at 0.25 CPU and 1 GiB, with zero output and no writable-layer changes. The harness temporarily captures the checker's output to verify that even errors emit nothing, and checks for writable-layer changes and a synthetic marker in temporary storage. Do not use real prose for diagnostics.

To stage the service alongside a configured [self-hosted installation](../deploy.md#self-hosted-compose):

```sh
docker compose --profile proofing up -d --build --wait languagetool
docker compose exec -T languagetool curl -fsS http://127.0.0.1:8081/ready
```

Port 8081 is reachable on the dedicated internal network shared only with the API. There is no host mapping, model mount, persistent volume or checker dependency in API readiness. `GET /ready` returns 200 with no body only after that JVM has obtained the expected `a hour` → `an hour` correction from its own `/v2/check` handler. This synthetic startup probe reruns on restart. An unhealthy JVM does not establish that saving is unhealthy; test note saves independently.

The Compose budget is **one CPU, 1 GiB RAM, zero additional swap**, a read-only root and a 32 MiB `/tmp` tmpfs. The non-root JVM uses Serial GC, `-Xms64m -Xmx512m`, one active HTTP check, no HTTP executor queue, a byte cap and independent text/time limits. Only English (`en-US`) pipelines are pre-warmed during startup, outside the normal 10-second check budget. The fixed synthetic startup check may retry at most three times; readiness still requires its actual expected correction. Container health allows 180 seconds for startup and the local rehearsal waits at most 240 seconds. Busy connections may close before a response. Do not retry or enqueue a draft. No n-grams, credentials, result cache, request logging, tracing exporter, core dumps or heap dumps are configured. The pipeline pool reuses an engine, not completed check results. Do not add debug output: upstream errors can include input.

## Build and refresh the image

[`ops/languagetool/Dockerfile`](../../ops/languagetool/Dockerfile) pins the builder and Temurin JRE by digest and the **6.8** standalone ZIP from Maven Central by SHA-256. A changed archive fails the build before extraction. Runtime downloads are unnecessary. The packaged upstream JARs, dictionaries, `COPYING.txt`, `README.md` and `third-party-licenses/` stay together in `/opt/lt`; do not strip notices. See the [6.8 release source](https://github.com/languagetool-org/languagetool/tree/v6.8). Review corresponding-source, LGPL and third-party redistribution obligations for the LT distribution, base JRE and added launcher **before distributing an image**.

```sh
docker build --pull --no-cache --platform linux/amd64 \
  -t grove-languagetool:qualified-local ops/languagetool
docker run --rm --network none --entrypoint sh grove-languagetool:qualified-local \
  -c 'sha256sum languagetool-server.jar COPYING.txt third-party-licenses/README.txt'
```

On refresh, independently verify the upstream release bytes and registry base digests, update the pins and startup version assertion together, rebuild without cache, compare distribution hashes and rerun the fixture plus the proofing corpus. Record the source revision, platform, base and archive hashes, scanning and license review, qualified image manifest and recovery image. A local config ID or mutable tag is not a registry digest. Protected production **Deploy** publishes or verifies the LanguageTool image in both GHCR and Docker Hub alongside API, MCP and Website images, probes its pulled digest and records `container-images.json`. The legacy `miniaxolotl/grove:languagetool-sha-<release-source>` alias remains available. See the [image publication contract](container-images.md). Publication does not change the app, enroll users, enable paragraph transmission or move the API image's `latest` tag to a checker. Deployment remains a separately authorized operator operation.

## DigitalOcean: stage with transmission off

**Release prerequisite:** the coordinated release deploys a new API/worker image and verifies both services on the new digest **before** publishing the website that uses their routes. Follow the [release contract](../release-conventions.md) and [schema rollout](../operations/schema.md). Proofing consent schema is required even when LanguageTool is disabled: both runtime roles probe its table. Automatic migrations use the separate owner connection; runtime probes stay read-only. A healthy previous API or website release is not evidence of a new migration.

**Release-managed rollout:** set the protected GitHub production environment variable `GROVE_LANGUAGETOOL_DEPLOY=true` to include the private service in product releases. Empty/`false` preserves the existing checker; other values fail closed. This is service-rollout authorization, **not** permission to transmit paragraphs. The verified checker digest from `container-images.json` is exported by publication and passed directly to the same run's provider proposal and waited deployment. It is not a manually configured digest/tag variable. The provider CLI requires the protected current production ref and the admitted source checkout.

The flagged release updates API/worker and checker together, replacing only a correctly scoped legacy/source-tagged checker image with the verified canonical `grove-languagetool` digest. Arbitrary tags, other registries, public routes, inherited secrets, unsafe overrides and unsettled apps are rejected. Existing checker sizing/count and component configuration are retained; an absent checker uses the private template below. The proposal is checked before npm publication, and freshness is rechecked before PUT. A retry already active on all exact digests makes no provider proposal/write. Website delivery waits for the provider's ACTIVE generation on all three images, including the checker's `/ready` health check on internal 8081 and at least 180 seconds of startup allowance.

Publishing an image alone still does not deploy it. Unflagged/operator rollouts retain their stricter existing pin/topology rules. The historical version-specific bootstrap is not reused. `LANGUAGETOOL_URL` stays empty until the post-deploy synthetic and privacy checks below pass; no GitHub checker URL variable is installed by service rollout. Source publication, a saved provider spec and active deployment are separate states. Browser store submissions are independent of checker delivery.

The [production template](../../.do/app.json) has no checker. The flagged release or an independent operator-supplied `--languagetool-digest` can add one private `miniaxolotl/grove-languagetool` component in an existing app. The independent operator path preserves active API/worker digests; the release path coordinates all three. A new checker uses one `apps-s-1vcpu-1gb-fixed` service with `internal_ports: [8081]` and a `/ready` health check, and adds no API URL, global environment, public HTTP port or ingress rule. An existing selected size is not silently changed. App-wide environment variables would be inherited: move configuration to its owning components before staging. Same-app private routing trusts sibling workloads; it does not authenticate each caller as Compose network isolation does not either. See [provider routing](https://docs.digitalocean.com/products/app-platform/how-to/manage-internal-routing/).

1. Follow the [protected release procedure](../deploy.md#release-and-rollout). Verify the admitted API/worker source and active immutable digest; obtain a separately approved and published checker digest with matching evidence. Retain the previous spec privately. Use a private operator env file, not credentials in command arguments.
2. Validate the proposal and inspect cost, region, sizing, ingress and all three image identities. Replace the placeholders with **verified** values:

   ```sh
   node --env-file=.env.digitalocean.local scripts/deploy-digitalocean.mjs \
     --app-id "$APP_ID" --digest "$ACTIVE_GROVE_DIGEST" \
     --languagetool-digest "$QUALIFIED_LT_DIGEST" --propose
   ```

   A proposal is not approval for a billable service. Only after explicit operator approval, use the same inputs with `--wait` instead of `--propose`. The script checks for concurrent changes before writing and requires the new active generation to carry both Grove images and the independent LT digest. Subsequent normal Grove releases preserve that LT pin; they do not refresh it.

3. Before enabling transmission, read back the actual internal ports, lack of public routes and environment isolation. From the API network namespace verify the known correction; from outside verify no checker endpoint is reachable. Run synthetic success, rejection, disconnect and timeout cases through the **actual** BFF, API, proxies and managed ingress. Check provider/edge logs, traces, error reporting, body buffering/spooling, swap, dumps, writable storage, egress and retention. Compose constraints are not guarantees about App Platform. If equivalent controls or marker absence cannot be verified, **leave the URL empty**.

## Cutover and rollback

After qualification, set **only the API component's** `LANGUAGETOOL_URL=http://languagetool:8081` (base origin), recreate/redeploy the API, and verify an opted-out, signed-out or expired session makes zero checks. Offer manual checks first to consenting writers; automatic checks require the separate user choice. Before expanding, run a mixed-paragraph soak alongside saves on the intended limits. Record aggregate dispatch-to-editor p95, busy/timeout counts, stale drops, RSS and restarts without drafts, corrections, account IDs or request IDs. A local smoke test is not a hosted latency or privacy result.

To stop transmission, clear the API URL, roll the API and verify old instances have drained. Check edits in flight, no late replacements, Harper local suggestions, saves and undo. In Compose, then `docker compose --profile proofing stop languagetool` (do not tear down shared volumes). On DigitalOcean, after approval either remove just the checker from the current private spec or re-propose its last qualified digest with the **current** Grove digest. Read back generation, routes and readiness again. Removing the URL alone does not stop billing. Do not reverse database migrations or roll back unrelated services to recover the checker.
