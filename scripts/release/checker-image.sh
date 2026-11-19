#!/usr/bin/env bash
# Invoked only by the protected, admitted coordinated publish job.
set -euo pipefail
[[ $RELEASE_SOURCE_SHA =~ ^[0-9a-f]{40}$ && $(git rev-parse HEAD) == "$RELEASE_SOURCE_SHA" ]]
node scripts/ci/current-ref.mjs
repo=miniaxolotl/grove
tag="$repo:languagetool-sha-$RELEASE_SOURCE_SHA"
err=$(mktemp); trap 'rm -f "$err"' EXIT
if ! digest=$(docker buildx imagetools inspect "$tag" --format '{{.Manifest.Digest}}' 2>"$err"); then
  grep -Eqi 'not found|manifest unknown|no such manifest' "$err" || { cat "$err" >&2; exit 1; }
  docker buildx build --platform linux/amd64 --provenance=mode=max --sbom=true --push --tag "$tag" \
    --label "org.opencontainers.image.revision=$RELEASE_SOURCE_SHA" \
    --label org.opencontainers.image.source=https://github.com/miniaxolotl/grove \
    --label org.opencontainers.image.title=grove-private-languagetool \
    --label org.opencontainers.image.version=6.8 ops/languagetool
  digest=$(docker buildx imagetools inspect "$tag" --format '{{.Manifest.Digest}}')
fi
[[ $digest =~ ^sha256:[0-9a-f]{64}$ ]]
docker pull "$repo@$digest"
[[ $(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$repo@$digest") == "$RELEASE_SOURCE_SHA" ]]
[[ $(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.title"}}' "$repo@$digest") == grove-private-languagetool ]]
# Exercise the pulled registry digest under the production resource ceiling.
probe=$(docker run -d --network none --read-only --log-driver none --memory 1g --memory-swap 1g --cpus 1 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m "$repo@$digest")
trap 'docker rm -f "$probe" >/dev/null; rm -f "$err"' EXIT
docker exec "$probe" curl -fsS --retry 25 --retry-all-errors --retry-delay 2 --max-time 2 http://127.0.0.1:8081/ready >/dev/null
node scripts/ci/current-ref.mjs
printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"
