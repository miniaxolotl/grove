#!/usr/bin/env bash
set -euo pipefail

# Only installed by the sandbox operator. No live workflow invokes this writer.
sandbox=miniaxolotl/grove-promotion-rehearsal
if [[ ${GITHUB_ACTIONS:-} != true || ${GITHUB_REPOSITORY:-} != "$sandbox" ||
      ${GITHUB_EVENT_NAME:-} != workflow_run || ${GITHUB_REF_PROTECTED:-} != true ||
      ${GITHUB_WORKFLOW_REF:-} != "$sandbox/.github/workflows/promotion-preview.yml@refs/heads/development" ]]; then
  echo 'Only the protected sandbox promotion observer may request auto-merge' >&2
  exit 1
fi

# Re-read GitHub and the checked-out history; never accept a supplied request
# body, PR artifact, head or destination. Preview also binds policy.repository.
preview=$(node scripts/release/promotion.mjs preview "${1:?native CI run ID required}")
query='mutation($input: EnablePullRequestAutoMergeInput!) { enablePullRequestAutoMerge(input: $input) { pullRequest { url headRefOid } } }'
request=$(jq -ec --arg query "$query" '{query:$query,variables:{input:.input}}' <<<"$preview")
gh api graphql --input - <<<"$request"
