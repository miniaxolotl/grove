# v1.10.0 production delivery

## Release identity — 22 October 2026 UTC

- Immutable source: [`v1.10.0`](https://github.com/miniaxolotl/grove/releases/tag/v1.10.0),
  `cb9b1a44ac8afee6d1c1aafd0f8a34e30c1e8d52`.
- Source tree: `1d08f77aac121f3ba6cff2df2ad034a1cd47bbb7`.
- Feature [#70](https://github.com/miniaxolotl/grove/pull/70) and Release Please
  [#71](https://github.com/miniaxolotl/grove/pull/71) merged through protected checks.
- Exact-source [CI 39724874807](https://github.com/miniaxolotl/grove/actions/runs/39724874807)
  and [Source Release 39724874992](https://github.com/miniaxolotl/grove/actions/runs/39724874992) passed.
- Frozen production [#72](https://github.com/miniaxolotl/grove/pull/72) merged as
  `8cea4497c0f6f997547cb875eca1f2b34ac2778c`, with the same source tree.
- Production [CI 39726145116](https://github.com/miniaxolotl/grove/actions/runs/39726145116)
  and [Deploy 39726145131](https://github.com/miniaxolotl/grove/actions/runs/39726145131) passed.

## Migration and runtime

Forward migration **`20261022_012_share_expiration`** is applied. Consumers were
paused and zero runtime database connections were verified before backup/migration.
The initial attempt stopped before mutation while one connection drained; the
unchanged retry passed. The verified **538,672-byte** PostgreSQL backup has SHA-256
`211c7cd0c515dae680b8e30a6be36b9f2e883f902ed1491f0c048cabc445ab24`.

All **29 retained-table fingerprints** match before/after. Existing share secrets,
versions and no-expiry access were preserved. Sharing RLS and actual non-owner
read denial pass; the worker has no public-reader function access. Previously
applied migrations 010/011 were retained. Backup/key custody remains private in the
operator inventory.

The compatible old image resumed after migration, then the release workflow
deployed API and worker to
`ghcr.io/miniaxolotl/grove@sha256:7901fa69a961b11e2d9a9a1a746535bf28ee707c798b2d0d1247622cb4a5711e`.
Deployment **`9500bbea-c9d4-44b8-b01b-09c51274dbde`** is active and healthy.
Provider configuration is independently identical apart from the admitted image
digest, preserving the API-only sharing key and other existing settings.

All five downloaded npm packages are **1.10.0**, match registry SHA-512/SHA-1
integrity, identify Grove's repository and advertise provenance. Bundled CLI
startup and native plugin-version pins verify independently.

## Website and live acceptance

Vercel's production-only build admission was restored after runtime verification.
Deployment **`dpl_99AkgVvsnT5YfSESQmWYWyzfowko`** is READY on the exact production
commit and serves <https://usegrove.cloud>.

Live acceptance passes on that exact release:

- Fresh visits and remembered dismissal send no optional requests. The short
  Analytics description is live; advertising-only consent loads the matching GTM
  and AdRoll pixel with HTTP 200. Revocation remains effective after reload.
- Real synthetic-account sign-in and private `no-store` proxy access work. Anonymous
  private-API access is denied, and the worker indexes a newly created test note.
- The owner dialog offers all six duration choices. Anonymous phone readers receive
  `no-store`, `noindex` and `no-referrer`; reading also works with JavaScript disabled.
- Saved edits remain live. Duration edits preserve the URL; identical mutation retries
  and rotation preserve the saved deadline.
- For exact-boundary verification, only this run's synthetic share deadlines were
  shortened using the database clock. Expired note and notebook capabilities return
  404; expired settings cannot reactivate them. Renewal creates a new secret, and
  the expired URL stays unavailable.
- Notebook scope narrowing and inherited-access removal take effect immediately.
  Revocation survives reload/back navigation. Successful and expired/revoked
  readers make no identity-provider or optional-tracking requests.
- The production worker completes an authorized relationship scan through the
  migrated schema. The run ends with no browser errors, revoked synthetic links
  and deleted newly created test notes.

Initial attempts encountered Chromium `ERR_NETWORK_CHANGED`. Their fixtures were
cleaned up and evidence retained; the final harness retries only that specific
read-only navigation error, with at most two retries. The passing run used two
such retries for its no-JavaScript reader and retained every acceptance assertion.

### Owner confirmation

After the production rollout, the owner reported: **“I tested grove and it works
fine.”** This records their successful Grove check alongside the detailed automated
sharing, expiry and relationship acceptance above.

## Delivered behavior

- Owners can choose **1 hour, 4 hours, 1 day, 1 week, 2 weeks or 1 month** (30 days),
  plus **No expiry**. PostgreSQL enforces the deadline on every public read.
- Active expiry edits preserve the URL. Retries, scope edits and replacement keep
  the saved deadline; renewing an expired link creates a new secret.
- Account/workspace layouts own authentication. Public readers retain `/s/<secret>`
  URLs and server-rendered, no-JavaScript reading.
- Website Analytics copy reads **“Understand site usage and performance.”**
  Published **GTM-M5WKD5LZ version 2** maps to Grove's AdRoll advertiser/pixel with
  public-route restrictions and independent advertising opt-in. The AdRoll dashboard
  independently reports **Pixel Active** and the existing-banner selection.

The links are opaque server-validated capabilities; pagination cursors are
separately signed. The observed Vercel capability-path canary remains documented in
[sharing](sharing.md): hosting-path redaction is not verified.

Local verification and reviewed desktop/phone captures are recorded in
[delivery evidence](delivery.md#timed-public-links-22-october-2026-utc).
