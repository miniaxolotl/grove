# Grove agent guidance

## Layout and verification

Grove is a memory API/worker with a Next.js website and prebuilt CLI, OpenCode,
Claude and Codex integrations. Shared code lives under `lib/`; the server is
`packages/api`, CLI/MCP under `packages/mcp`, and website under `packages/website`.
Use pnpm 10.33 and Node 24. Preserve package paths and user worktrees.

Read the main checkout's `plans/README.md`, active plan/status files, related
tickets and `documentation/delivery.md` before work. Use a clean worktree under
`worktrees/`, keep local plans under ignored `plans/`, and update status as work
progresses. Create minimally labelled PRs assigned to `miniaxolotl`.

Run `pnpm lint`, `pnpm check-types`, `pnpm build`, `pnpm test:artifacts` and the
relevant tests. `documentation/development/testing.md` describes disposable
PostgreSQL/RLS and browser verification. Release changes also require
`node --test scripts/release/*.test.mjs` and workflow lint. Never weaken tenant
isolation, delete retained provider data or reset an existing database to pass CI.

## Release contract

- Feature PR → protected `development` → frozen `promote/production/vX.Y.Z` PR →
  protected `production`. Promotion uses a merge commit. No direct protected-branch
  pushes, forced candidates, moved tags or automatic moving-head promotion.
- Release Please owns one product version, root changelog, all five shipped
  package versions and native/marketplace pins. Shared CLI/library changes must
  release every bundled consumer together. Historical component changelogs/tags
  are retained; the first coordinated release converges at 1.2.0.
- Development performs CI and Release Please only. Production publishes npm and
  images, deploys API/worker and builds the Vercel site. Existing preview resources
  need an explicit separate retirement decision.
- `CI Gate` validates the full job inventory and requires classification, admission
  and every selected job; unselected jobs must be skipped. Push/manual source CI
  remains full. Frozen selection requires independent exact
  source CI, Release Please provenance, matching trees and operator/run evidence.
  `GITHUB_TOKEN` automation explicitly dispatches generated-PR CI; no PAT is used.
- Check every package's registry integrity and provider configuration before
  publication. Missing DigitalOcean configuration is an error. Deploy the admitted
  source image by digest, never infer source identity from the production merge SHA.
- Auto-merge waits for strict required CI and resolved conversations. It is not
  a bypass. Retry partial releases without overwriting published versions.
- Follow `documentation/deploy.md`; schema migrations are explicit, forward-only
  owner operations before incompatible rollout. Keep secrets out of source/plans.
