#!/usr/bin/env bash
# Local/CI runtime qualification. Never publishes or contacts a live application.
set -euo pipefail
cd "$(dirname "$0")/../.."
prefix="grove-runtime-fixture-$$"
images=()
cleanup() {
  if (( ${#images[@]} )); then docker image rm "${images[@]}" >/dev/null; fi
}
trap cleanup EXIT
for component in api mcp website; do
  image="$prefix-$component:local"
  docker build --platform linux/amd64 --target "$component" --tag "$image" \
    --build-arg SITE_URL=https://grovenote.app \
    --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmstaXNvbGF0aW9uLmNsZXJrLmFjY291bnRzLmRldiQ= .
  images+=("$image")
  node scripts/testing/container-images.mjs "$component" "$image"
done
