#!/usr/bin/env bash
# Run on reviewed source in a credential-free job. Keep each fetch's virtual
# store separate; only the content-addressed pnpm store is shared with builds.
set -euo pipefail
source_sha=${1:?expected candidate SHA}
[[ $source_sha =~ ^[0-9a-f]{40}$ && $(git rev-parse HEAD) == "$source_sha" ]]
: "${npm_config_store_dir:?set the same absolute store directory for fetch and offline install}"
[[ $npm_config_store_dir == /* ]]
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
jq -er --arg candidate "$source_sha" '([$candidate] + [.targets[].source]) | unique[]' \
  "${2:-scripts/release/impact-receipts.json}" > "$tmp/sources"
while IFS= read -r rev; do
  [[ $rev =~ ^[0-9a-f]{40}$ ]]
  git merge-base --is-ancestor "$rev" "$source_sha"
done < "$tmp/sources"
while IFS= read -r rev; do
  mkdir "$tmp/source"
  git archive "$rev" | tar -xf - -C "$tmp/source"
  (cd "$tmp/source" && pnpm fetch --frozen-lockfile --ignore-scripts)
  rm -rf "$tmp/source"
done < "$tmp/sources"
