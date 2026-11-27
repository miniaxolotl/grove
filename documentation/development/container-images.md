# Container images

Protected production **Deploy** builds or reuses four exact-source Linux amd64
images and publishes each to **GHCR and Docker Hub**:

| Runtime        | GHCR                                     | Docker Hub                       | Default process                        |
| -------------- | ---------------------------------------- | -------------------------------- | -------------------------------------- |
| API and worker | `ghcr.io/miniaxolotl/grove-api`          | `miniaxolotl/grove-api`          | API; worker uses `node dist/worker.js` |
| MCP bridge     | `ghcr.io/miniaxolotl/grove-mcp`          | `miniaxolotl/grove-mcp`          | `grove mcp --stdio`                    |
| Website        | `ghcr.io/miniaxolotl/grove-website`      | `miniaxolotl/grove-website`      | Next.js standalone server, port 3000   |
| LanguageTool   | `ghcr.io/miniaxolotl/grove-languagetool` | `miniaxolotl/grove-languagetool` | Private checker, port 8081             |

Every component has `sha-<released-source>`, coordinated `vX.Y.Z` and `latest`
tags. Deploy by **digest**, not `latest`. The LanguageTool product tag follows
Grove's release; its upstream engine remains independently pinned to 6.8.
For existing consumers, `ghcr.io/miniaxolotl/grove` and `miniaxolotl/grove` retain
their API tags and identical digest. The legacy Docker Hub
`grove:languagetool-sha-<source>` tag remains a checker-only compatibility alias;
it never replaces the API's `latest`.

## Publication and retries

The existing candidate admission, protected production environment, independent
source CI and current-ref fences apply. Development/PR CI builds and tests images
without publishing. Docker Hub uses the existing repository credentials; GHCR
uses the publishing job's package-write token. Missing registry permission is a
failure, not permission to skip a destination or suppress a registry error.

`scripts/release/container-images.mjs` preflights all immutable component tags
across both registries before writes. It rejects conflicting digests and verifies
existing image source/component labels and runtime smoke checks before creating
new images. Missing components are built with provenance and SBOMs. The pulled
digest must pass a non-root, isolated runtime check before source-tag mirrors are
verified. After npm publication, release and `latest` tags are mirrored and read
back. Every observed immutable-tag conflict stops the run; retries reuse a valid
existing digest rather than overwrite or rebuild it. An interrupted mirror is
reconciled through fresh registry reads on retry.

`container-images.json` records all four component digests, source and release
tag in the release workflow artifact. The existing `manifest.json` keeps the API
identity used by downstream deployment. Publication does **not** add a paid
checker, change its saved size/count, configure an API checker URL, enroll users
or transmit paragraphs. Follow the separate [checker rollout](languagetool-operations.md)
and [deployment procedure](../deploy.md) for live changes. Vercel remains the
website deployment target; publishing its container does not switch providers.

## Runtime configuration

API and worker retain their separate database roles and existing configuration.
The root Dockerfile's default `production` target remains the API for existing
Compose users; explicit targets are `api`, `mcp` and `website`.

The MCP image is the existing stdio bridge, not another HTTP API. Run it with
stdin attached, for example `docker run --rm -i --env GROVE_API_URL --env GROVE_API_KEY
miniaxolotl/grove-mcp@sha256:<verified-digest>`. Supply credentials through the
environment or supported private configuration, never an image build argument.
Do not publish a port: the API image already owns Streamable HTTP `/mcp`.

The Website image uses Next.js standalone output plus its public/static assets.
Publication reads the existing Vercel production project into a disposable
directory and allowlists only `SITE_URL`, the Clerk publishable key and public
telemetry settings for the build. Runtime secret keys, API credentials and Sentry
upload tokens never enter the Docker context or build arguments. The temporary
provider files are removed; `.vercel` and the exported public-config file are
excluded from the context. Runtime `CLERK_SECRET_KEY` and `GROVE_API_URL` still
belong in the deployment's private environment. Public settings are baked and
require an image rebuild to change. `/release.json` exposes the image's source
and product version; it is not evidence that this image serves the live website.

## Local and CI verification

After installing locked dependencies, run:

```sh
node --test scripts/release/container-images.test.mjs scripts/release/website.test.mjs
bash scripts/testing/verify-images.sh
bash ops/languagetool/verify.sh
```

The runtime fixture builds API, MCP and Website targets without publication,
uses synthetic public website settings and removes only its own image tags.
It checks API entrypoints/native imports, real MCP initialization/tool discovery,
and Website readiness, homepage and static-asset delivery with no external
network. These are bounded container smoke tests, not live authentication or
full API/provider acceptance. The separate backend suite verifies real disposable
database/RLS/queue/storage behavior. The checker rehearsal additionally exercises
known corrections, failures, overload, privacy, restart and constrained cold start.
Keep all build/test commands, initial failures and final exact-source evidence in
the PR; follow the [standard verification](testing.md) before pushing.
