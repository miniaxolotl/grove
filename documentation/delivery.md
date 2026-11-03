# Delivery and evidence

Current behavior belongs in the [topic guides](README.md). Source delivery is not
production acceptance: a merged PR or passing fixture does not establish provider,
device, deployment or model-quality acceptance.

- **For a change:** put exact-head checks, commands, failures/skips and remaining
  limits in its PR. Keep execution plans/logs outside the repository.
- **For visual evidence:** use the feature's existing
  `design/screenshots/<topic>/README.md`, with synthetic inputs, source/build,
  viewports, observed results and qualification limits. Do not recapture unrelated
  features or present old screenshots as the current release.
- **For evaluations:** keep a dated, scoped report linked from the owning topic.
  Distinguish deterministic contracts, measured results and unverified acceptance.
- **For releases:** follow [deployment](deploy.md) and
  [release conventions](release-conventions.md); record the admitted source/tag,
  immutable image, package integrity, migration evidence and actual live checks in
  the release PR. Never infer runtime identity from the production merge SHA.

Do **not** append feature summaries or test totals here. Unrelated PRs should not
need to edit this file. [Documentation maintenance](development/documentation.md)
describes topic ownership and validation.

## Historical evidence

The [archive index](archive/README.md) links the preserved delivery ledger and
superseded runbooks at their immutable source revision. They record past outcomes,
not current configuration or permission to repeat an operation. Existing screenshots
and scoped evaluation reports retain their original provenance.
