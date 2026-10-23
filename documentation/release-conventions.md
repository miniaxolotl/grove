# Release and contribution conventions

## One release structure

All four products use one root Release Please manifest and changelog, action
5.0.0 pinned by SHA, library/schema 17.6.0 and the upstream `node` strategy with
`versioning: always-bump-patch`. Root `package.json` and the manifest agree;
product-specific `extra-files` keep Go, Flutter and bundled package versions in sync.
Historical bootstrap SHAs, existing versions and published tags are preserved.

- Routine `fix`, `feat`/`feature`, `perf` and `revert` changes produce patch releases.
- Minor/major versions require a deliberate `Release-As: X.Y.Z` commit footer.
- Breaking `!`/`BREAKING CHANGE` commits block source automation until an explicit
  higher version is selected. Conflicting/malformed/non-increasing decisions fail.
- Docs/tests/chores/CI/refactoring alone do not create releases. An explicit release
  decision can be a separate reviewed `chore(release)` commit.
- Put the footer in the **actual merged commit**, including the squash message;
  a PR comment or an unmerged commit is not release intent.
- Tags and release names are plain `vX.Y.Z`, with no component prefix. Pre-1
  releases carry GitHub's prerelease flag without a semantic-version suffix.
- Release Please owns version/changelog updates. Do not hand-edit a feature's
  version, repeat bootstrap overrides, force tags or overwrite published artifacts.

Source Release runs only on protected `development`, serially without cancellation.
It checks release intent before invoking Release Please. Website/Burrow/Grove use
job-scoped `GITHUB_TOKEN` plus explicit generated-PR CI dispatch. Fern retains its
dedicated release credential and manifest-format normalizer because generated PR
updates must also trigger Apple source checks; changing that handoff is a separate
tested cutover. This is the documented credential exception, not a version-policy
difference. Runner placement is unchanged.

## Names and PR delivery

| Item                 | Convention                                       | Example                             |
| -------------------- | ------------------------------------------------ | ----------------------------------- |
| Feature branch       | `type/scope-short-description`                   | `fix/ci-admission-retry`            |
| Commit               | `type(scope): imperative summary`                | `fix(ci): reject stale evidence`    |
| Feature PR title     | Same conventional form; concise and squash-ready | `feat(albums): add cover selection` |
| Generated release PR | Release Please-owned ref and title               | `chore(release): release 1.6.1`     |
| Source tag           | Immutable `vX.Y.Z`                               | `v1.6.1`                            |
| Promotion branch     | Immutable `promote/<target>/vX.Y.Z`              | `promote/production/v1.6.1`         |

Prefer `feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `ci`, `build` and `chore`;
legacy `feature` remains recognized. Do not rename automation-owned release refs
or mix unrelated fixes into a commit. Target feature PRs at `development`; a
deliberately stacked PR names its real parent and gets explicit exact-head source
CI when ordinary trigger filters do not cover that base. Retarget/revalidate after
the parent merges.

Use worktrees under `~/Development/bramble-labs/worktrees/<project>` (a distinct
task suffix when that path is occupied). Keep `plan.md`, `notes.md`, `status.md`
under `~/Development/bramble-labs/plans/<project>`, outside Git. Assign PRs to
`miniaxolotl`, use one relevant label and keep descriptions focused on changes,
verification and remaining rollout requirements. Include screenshots only for
relevant visual changes: at most four previews per row, full evidence in
`documentation/`. Require current-head CI Gate, resolved conversations and no
conflicts; auto-merge grants no bypass. After confirmed merge, remove only the
clean stale task worktree. Automatic remote feature-head deletion is enabled;
core/frozen refs remain protected.

## Promotion is separate from source release

Website/Burrow/Grove: feature PR → development → released tag → deliberately
selected frozen production PR → production. Fern additionally stages the candidate
and records exact server/native/TestFlight/provider/device acceptance before
production prepares the **same accepted build** for owner App Review.

Promotions use merge commits, preserve released tree identity and require
independent exact-source validation. A source tag, green PR or documentation change
does not authorize deployment, database/provider changes or store submission.
Secrets belong in Doppler and private ignored `secrets.md`, never PRs or artifacts.

Verification lives in `scripts/release/release-policy.test.mjs` (real upstream
version/update fixtures), `release-intent.test.mjs` and `release-workflow.test.mjs`.
Use the upstream strategy rather than duplicating version calculations. Common
helpers/contracts stay identical across independently runnable repositories;
only repository identity, history, version-file mappings and the Fern token
handoff differ.
