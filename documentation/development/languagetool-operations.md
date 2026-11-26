# Operating the private LanguageTool checker

Grove works with `LANGUAGETOOL_URL` empty. Starting a checker does not enroll writers or send their text. The only intended caller is Grove's API, for a masked paragraph from a consenting, signed-in note editor. Never configure the public LanguageTool API, route browsers directly to the checker, or publish its port.

## Rehearse locally

From the repository root, use a local Docker Engine with Compose, BuildKit, cgroup v2, and memory/swap accounting:

```sh
bash ops/languagetool/verify.sh
```

This builds and runs the actual `proofing` service in a disposable project without a database or real credentials. It checks a known correction, malformed and oversized forms, simultaneous requests, a disconnected client and a container restart. It temporarily captures the checker's output to verify that even errors emit nothing. The harness checks for writable-layer changes and a synthetic marker in temporary storage. Do not use real prose for diagnostics.

To stage the service alongside a configured [self-hosted installation](../deploy.md#self-hosted-compose):

```sh
docker compose --profile proofing up -d --build --wait languagetool
docker compose exec -T languagetool curl -fsS http://127.0.0.1:8081/ready
```

Port 8081 is reachable on the dedicated internal network shared only with the API. There is no host mapping, model mount, persistent volume or checker dependency in API readiness. `GET /ready` returns 200 with no body only after that JVM has obtained the expected `a hour` → `an hour` correction from its own `/v2/check` handler. This synthetic startup probe reruns on restart. An unhealthy JVM does not establish that saving is unhealthy; test note saves independently.

The Compose budget is **one CPU, 1 GiB RAM, zero additional swap**, a read-only root and a 32 MiB `/tmp` tmpfs. The non-root JVM uses Serial GC, `-Xms64m -Xmx512m`, one active HTTP check, no HTTP executor queue, a byte cap and independent text/time limits. Busy connections may close before a response. Do not retry or enqueue a draft. No n-grams, credentials, result cache, request logging, tracing exporter, core dumps or heap dumps are configured. The pipeline pool reuses an engine, not completed check results. Do not add debug output: upstream errors can include input.

## Build and refresh the image

[`ops/languagetool/Dockerfile`](../../ops/languagetool/Dockerfile) pins the builder and Temurin JRE by digest and the **6.8** standalone ZIP from Maven Central by SHA-256. A changed archive fails the build before extraction. Runtime downloads are unnecessary. The packaged upstream JARs, dictionaries, `COPYING.txt`, `README.md` and `third-party-licenses/` stay together in `/opt/lt`; do not strip notices. See the [6.8 release source](https://github.com/languagetool-org/languagetool/tree/v6.8). Review corresponding-source, LGPL and third-party redistribution obligations for the LT distribution, base JRE and added launcher **before distributing an image**.

```sh
docker build --pull --no-cache --platform linux/amd64 \
  -t grove-languagetool:qualified-local ops/languagetool
docker run --rm --network none --entrypoint sh grove-languagetool:qualified-local \
  -c 'sha256sum languagetool-server.jar COPYING.txt third-party-licenses/README.txt'
```

On refresh, independently verify the upstream release bytes and registry base digests, update the pins and startup version assertion together, rebuild without cache, compare distribution hashes and rerun the fixture plus the proofing corpus. Record the source revision, platform, base and archive hashes, scanning and license review, qualified image manifest and recovery image. A local config ID or mutable tag is not a registry digest. The coordinated production workflow publishes the exact checker under `miniaxolotl/grove:languagetool-sha-<release-source>` and stages its immutable digest. It never moves the application image’s `latest` tag to the checker.

## DigitalOcean: stage with transmission off

**Release prerequisite:** the coordinated release deploys a new API/worker image and verifies both services on the new digest **before** publishing the website that uses their routes. Follow the [release contract](../release-conventions.md). The migration owner must first apply the admitted source’s forward migration `20261118_044_proofing_consent`, even when LanguageTool is disabled: both runtime roles probe its table. Production deploy checks are intentionally read-only. A healthy previous API or website release is not evidence of this migration.

**Approved rollout for #282:** the recovery includes the reviewed browser-download tooling (#286) at the v1.11.26 source stamp (#287). The v1.11.27 promotion applied 043/044, but its checker build stopped before rollout. The v1.11.28 publisher repair requires a fresh release stamp and frozen promotion from that baseline. Confirm the actual merge parent and tree; verify the existing schema with read-only probes rather than replaying migrations. Before promotion, the database owner applies migration 044 from the admitted source using the existing [managed PostgreSQL migration procedure](../deploy.md#release-and-rollout). Verify read access from both runtime roles; no database-owner credential goes into the release workflow. The protected publisher verifies schema, builds the checker, pulls its immutable digest and probes it with one CPU/1 GiB. It validates the three-component provider proposal, publishes the coordinated packages and attaches the browser downloads. The deploy job applies the approved private checker, API and worker spec together and verifies the active generation and API readiness. Vercel runs after backend success. Expect one additional $10/month checker. `LANGUAGETOOL_URL` remains empty until the post-deploy synthetic and privacy checks below pass. If a different change lands on development first, reconcile release scope before proceeding. Browser store submissions are independent of GitHub downloads.

The [production template](../../.do/app.json) has no checker. Outside the scoped coordinated rollout, an ordinary release cannot add one. Only an operator-supplied `--languagetool-digest` proposes a separate `miniaxolotl/grove-languagetool` image in an existing app. It preserves the active API/worker digest, adds one `apps-s-1vcpu-1gb-fixed` service with `internal_ports: [8081]` and a `/ready` health check, and adds no API URL, global environment, public HTTP port or ingress rule. App-wide environment variables would be inherited: move configuration to its owning components before staging. Same-app private routing trusts sibling workloads; it does not authenticate each caller as Compose network isolation does not either. See [provider routing](https://docs.digitalocean.com/products/app-platform/how-to/manage-internal-routing/).

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
