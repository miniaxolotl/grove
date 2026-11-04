# Maintaining documentation

## One owner per topic

- Keep each feature's behavior, API, limits, rollout prerequisites and focused
  verification together in its existing topic guide. Add a page only for a distinct
  contract or audience; do not create a file per task, PR or migration.
- Link shared contracts instead of copying quota tables, provider defaults,
  authentication rules or release steps. Code catalogs, migration registration,
  manifests and workflow files own exact executable values.
- Keep `README.md`, `delivery.md`, `deploy.md` and `development/testing.md` stable.
  Routine feature PRs do **not** append entries to them. Change a shared guide only
  when the shared process changes; new navigation may need a short index link.
- Local plans, investigation transcripts and running status belong outside Git in
  `~/Development/bramble-labs/plans/<project>/{plan,notes,status}.md`.
  PR descriptions own exact-head checks and integration/merge state.
- Keep reviewed synthetic screenshots in the existing topic gallery, with accurate
  source/build, viewport and acceptance limits. Do not regenerate unrelated captures.
  No screenshot is needed for prose-only maintenance.

## Current guidance versus evidence

Write current behavior in the present tense. Remove obsolete provisional migration
names, stacked-PR state, old test totals and repeated implementation narratives from
current guides. Preserve useful dated evidence in a scoped report/gallery or link its
immutable Git revision from the [archive](../archive/README.md); label its scope.

Never promote a historical observation to a current fact without fresh evidence.
Configuration/key presence is not provider health. Fixture success is not live-host,
payment, semantic-quality, physical-device or production acceptance. Keep known
limitations in the owning guide until genuinely qualified, not in an ever-growing
central backlog. Documentation alone authorizes no deployment/provider/data action.

## Validate a change

1. Compare claims with the relevant source contracts/tests. Check exact migration
   names against `lib/database/src/migrations.ts`, commands against package scripts,
   configuration against `.env.example`/runtime parsing, and release steps against
   workflows. Do not copy deployed settings from an old work log.
2. Run `pnpm test:docs` for parsed Markdown links/images/anchors and checker regressions.
   It checks all documentation, not just changed pages. Root-relative application
   routes and external URLs are not fetched; verify changed external references
   separately when their availability/content matters. Code examples are not executed.
3. Run changed-file Prettier and `git diff --check`, required root gates and relevant
   tests per [verification](testing.md). Public reference prose also needs the
   production website build and discovery browser checks.
4. Preserve public reference filenames/slugs unless deliberately migrating their
   allowlist in `packages/website/src/content/documentation.ts`. Arbitrary repository
   files must never become public simply because they are linked from a guide.
5. Record what was checked and what remains unverified in the PR. Do not claim
   automated link checks prove there are no semantic gaps.

The documentation workflow validates links on documentation PRs independently of
the main CI dependency selection. It adds no deployment or publication authority.
