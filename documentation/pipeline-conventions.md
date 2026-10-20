# Shared CI/CD conventions

Fern, Burrow and Grove share this baseline. Keep common action pins and workflow
contracts synchronized when updating them.

| File          | Name                     | Responsibility                                                     |
| ------------- | ------------------------ | ------------------------------------------------------------------ |
| `ci.yml`      | CI                       | Validate source or admit a frozen promotion; finish with `CI Gate` |
| `release.yml` | Source Release           | Release Please on development; immutable source tags               |
| `promote.yml` | Select Release Candidate | Operator-selected tag, independent source CI, frozen PR            |
| `deploy.yml`  | Deploy                   | Burrow/Grove production: `candidate` → `publish` → `deploy`        |

Fern delivers through `stage-release.yml` (images and production services), Xcode
Cloud (eligible TestFlight), and `store-release.yml` (prepare the accepted build).

## Common baseline

- Node **24.21.0**, frozen pnpm installs, full action SHA pins with version comments.
- Checkout **7.0.1**, setup-node **7.1.0**, upload-artifact **7.0.2**, Release Please
  action **5.0.0** / library **17.6.0**, Docker setup-buildx **4.4.1**, login
  **4.6.0**, build-push **7.4.0**, OpenTofu setup **2.0.2** / CLI **1.12.6** where used.
- Read-only default tokens, job-scoped writes/OIDC, nonpersistent checkout
  credentials and independent immutable publication source identities.
- Shared `Promotion Admission`, `Website` and `CI Gate` names; source evidence
  requires every stack-specific job listed by the release policy.
- CI cancels superseded PR runs only. Release/selection/deployment operations
  serialize without cancellation. Every job has a timeout.
- The same checksum-verified actionlint **1.7.12** launcher validates workflows.
- Artifact preflight → publication → service rollout; immutable digest reuse,
  strict registry integrity, retained source/tag/digest evidence, readiness checks.
- Protected PRs, strict `CI Gate`, resolved conversations and frozen refs.
  Auto-merge grants no bypass.

## Stack-specific choices

- Burrow/Grove: `pnpm/action-setup` **6.1.0** supports their pnpm 10 manifests.
  Fern: `pnpm/setup` **3.1.1** requires pnpm 11+ and installs its pinned runtime.
- Burrow: Go/GoReleaser and real HTTPS tunnel checks. Grove: PostgreSQL/RLS, packed
  agent clients and API/worker readiness. Fern: Flutter/Android, Apple iOS tests,
  provider/migration acceptance and owner App Review.
- Burrow/Grove: `GITHUB_TOKEN` with explicit generated-PR CI dispatch. Fern: its
  dedicated release credential supports Apple-triggered source automation.
- Burrow/Grove: protected-push/PR validation on GitHub runners. Fern: classified
  PR/merge-group CI, complete exact-tag dispatch, Blacksmith sizing and coverage.

The workflow files contain authoritative SHA pins and job details.
