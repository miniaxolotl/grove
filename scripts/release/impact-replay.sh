#!/usr/bin/env bash
# Slow integration replay. Keep synthetic objects/refs out of the real checkout.
set -euo pipefail
tool=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q --shared --no-checkout "$(git rev-parse --show-toplevel)" "$tmp/repo"
cd "$tmp/repo"
web=171398380897a230050a99bc703089630a5b4467
asset=packages/website/public/brand/wordmark-primary.svg
git read-tree "$web"
blob=$({ git show "$web:$asset"; echo '<!-- shared wordmark replay -->'; } | git hash-object -w --stdin)
git update-index --cacheinfo "100644,$blob,$asset"
brand=$(git -c user.name=Replay -c user.email=replay@example.invalid commit-tree "$(git write-tree)" -p "$web" -m 'Shared wordmark fixture')

node "$tool/impact-snapshot.mjs" "$web^" > "$tmp/base.json"
node "$tool/impact-snapshot.mjs" "$web" > "$tmp/web.json"
node "$tool/impact-snapshot.mjs" "$brand" > "$tmp/brand.json"
node "$tool/impact-plan.mjs" --replay "$tmp/web.json" "$tmp/base.json" > "$tmp/web-plan.json"
node "$tool/impact-plan.mjs" --replay "$tmp/brand.json" "$tmp/web.json" > "$tmp/brand-plan.json"
node --input-type=module - "$tmp" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
for (const [fixture,selected] of [['web',['website']],['brand',['website','downloads']]]) {
  const {targets}=JSON.parse(readFileSync(`${process.argv[2]}/${fixture}-plan.json`));
  assert.equal(Object.keys(targets).length,8);
  for (const [name,{state,changes}] of Object.entries(targets)) {
    assert.equal(state,selected.includes(name)?'selected':'unchanged',`${fixture}: ${name}`);
    if (state==='selected') console.log(`${fixture}: ${name}: ${changes.join(', ')}`);
  }
  if (fixture==='brand') assert.deepEqual(targets.downloads.changes,['chrome/wordmark.svg','edge/wordmark.svg','firefox/wordmark.svg']);
}
JS
