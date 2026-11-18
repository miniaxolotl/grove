#!/usr/bin/env bash
# Offline reviewer handoff from immutable Git objects; never archive a worktree,
# its environment, node_modules, or local browser profiles.
set -euo pipefail
if [[ $# != 3 || ! $1 =~ ^[a-f0-9]{40}$ ]]; then
  echo 'Usage: bash scripts/package-browser-reviewer-source.sh GROVE_COMMIT HARPER_CHECKOUT OUTPUT.tar.gz' >&2
  exit 2
fi
root=$(git rev-parse --show-toplevel)
source_sha=$1
upstream=$2
output=$3
harper_sha=ea9ab1b8f95be99a5d4040c53be92a6c2ad7f7f3 # upstream v3.2.0
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Fail closed on a future dependency bump until its source inputs are reviewed.
git -C "$root" show "$source_sha:lib/shared/package.json" | node --input-type=commonjs -e '
  const pkg = JSON.parse(require("node:fs").readFileSync(0));
  if (pkg.dependencies["harper.js"] !== "3.2.0") process.exit(1)'
git -C "$root" archive --format=tar --prefix=grove/ -o "$work/grove.tar" "$source_sha" -- \
  package.json ':(glob)**/package.json' .npmrc pnpm-lock.yaml pnpm-workspace.yaml \
  LICENSE tsconfig.json lib packages/browser-extension scripts/build-browser-extension.mjs \
  packages/website/public/brand/wordmark-primary.svg packages/website/public/brand-kit/{licenses,fonts} \
  documentation/browser-extension.md
# Include Harper's Rust sources, dictionary, Cargo.lock, toolchain, wasm-pack
# recipes, JS glue sources, lockfiles and upstream license, not just the binary.
git -C "$upstream" archive --format=tar --prefix=harper/ -o "$work/harper.tar" "$harper_sha"
tar -Af "$work/grove.tar" "$work/harper.tar"
cat > "$work/BUILD.txt" <<EOF
Grove source: $source_sha
Harper 3.2.0 source: $harper_sha (Automattic/harper)
In grove/, use Node 24 and pnpm 10.33: pnpm install --frozen-lockfile --ignore-scripts && pnpm build:extension
Compare packages/browser-extension/dist/grove-{chrome,edge,firefox}.zip to the submitted package.
The normal build uses the integrity-locked npm package's dist/harper_wasm_slim_bg.wasm.
Upstream WASM/JS build recipe: in harper/, use the upstream toolchain and just build-harperjs.
Consult harper/justfile and harper/rust-toolchain.toml for the no-default-features slim build.
EOF
tar --mtime=@0 --owner=0 --group=0 -rf "$work/grove.tar" -C "$work" BUILD.txt
gzip -n -c "$work/grove.tar" > "$output"
