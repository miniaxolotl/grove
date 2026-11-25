# Qualified held operator adapters

## Current acceptance boundary — live effects remain blocked

Concrete offline mechanisms are implemented, but this source is **not a
production-qualified installation**. In particular:

- The trusted product bootstrap checks an externally pinned closure **before**
  importing the supplied operator root. `scripts/release/held-operator-trust.json`
  intentionally has no closure/public-key/app-authority pins. Parent must independently approve
  and pin the complete operational code/dependency installation. The bootstrap
  requires a root-owned, non-user-writable installation/ancestry and an
  unprivileged operator process; it does not defend a malicious root/admin.
  `qualified-code.json` is schema 1, `base:"../.."` for the complete code checkout,
  and `files:{relativePath:sha256}` covering all executable modules, resolver package
  metadata and installed transitive dependency sources. Its **raw byte hash** is
  the source-controlled `closureSha256`; the independently approved public key's
   raw PEM hash is `reviewKeySha256`. No CLI flag may supply or override either pin.
- Production configuration must use that bundle's exact `admitted-source` root.
  An independently located source tree is rejected before source import, even if
  its files match: its dependency resolution must be the verified bundle graph.
  The migration CLI uses the database module returned by that qualified installation;
  it never rereads mutable configuration to choose an import after loading credentials.
- `authority.py` implements an independent SQLite authority outside code/custody:
  existing-only ordinary opens, directory/database identities, cross-process
  serialization, unique consumes and sequence/hash CAS. Provisioning and every
  write verify effective WAL and synchronous FULL; wrong-mode existing stores
  fail, never repair/reset. Query-only readback uses a private WAL index,
  no checkpoint-on-close and no clock update. Python 3 with `setconfig`, Linux
  procfs/flock/pidfds and the reviewed OS toolchain are required.
- Authority/supervisor launches and both toolchain probes use the same fixed
  `/usr/bin/python3 -I -S -B` boundary. `-I` alone still initializes global
  `site`/`sitecustomize`; `-S` excludes those hooks before script execution or pin
  discovery. These scripts use only the standard library. The `/usr/`-only,
  immutable OS-tool closure checks remain unchanged; site hooks are not whitelisted.
  The closure also binds the fixed `/usr/bin/python3` launch alias to its reviewed
  canonical interpreter (`tools.pythonPath`). Alias drift rejects admission even
  if the old interpreter and its pinned files remain present. Older closures
  without this binding must be regenerated and independently reviewed.
- One externally pinned app database survives source/custody/code changes.
  Registered installation descriptors bind each source, code closure, custody
  UUID and work-root identity separately. Installing another source must register
  in that database, not create another app lock. A changed global authority digest
  fails the independent `appAuthoritySha256` pin. The trusted privileged admin must
  preserve this authority and never roll it backwards, replace it or roll back the
  entire disk to clear uncertain effects. No app migration or new service is used.
- DigitalOcean documents no CAS/If-Match generation input. Reads before and after
  PUT are not atomic protection. A signed, time-bounded cooperating-writer window
  binds source, manifest, publication, app/image, registered custody and independent
  authority. It includes the owner's dashboard custody and paused-controller
  evidence. SQLite serializes provider, migration, backup and owner SQL commands
  app-wide; it cannot fence dashboard users. Actual operational exclusion is a
  separate owner obligation, not something inferred from a local lock.
  Requests preserve source versions with `update_all_source_versions:false`.
- Production-scope review conditionally admits execution only with the full code,
  dependency, source, fixture, registered/pinned authority and signed-window checks.
  Missing pins/configuration still block before credential loading. Fixture scope
  never admits execution. Admission does not establish live custody or readiness.

The app source and operational code are independently frozen identities. Historical
`bae8decf` fixtures are provisional only; a later release requires its own immutable
source and fresh report. Parent owns final tag/publication facts and live
qualification. Neither identity is inferred from the other.

This is a new parameterized version of the retained operator mechanisms, not a
new backup service, secret store, migration registry or queue. It carries forward
the exported PostgreSQL snapshot/custom dump, AES256 retained readback, isolated
PG17.12/vector0.8.0 restore, complete catalog/row preservation, private files,
fsynced journals and bounded owner transaction. The historical external stack
and its `FROZEN_V11129_COMPOSITION_BLOCKED` manifest remain unchanged and rejected.

**Nothing here authorizes a live operation.** An unconfigured installation is
non-executable, before credential loading. Fixture qualification never establishes
live readiness. The parent owns maintenance, final immutable source selection,
independent review, credentials, original custody, fresh live backup, publication,
lifecycle/provider reconciliation and reopening. Follow the
[held release contract](../../documentation/development/held-release.md).

## Factories and authority

- `createControl(root)` confines private files, journals and exclusive consumption
  to an absolute independently owned 0700 root. Files must be owned, private,
  regular, single-linked and no-follow; ancestors cannot be symlinks or writable
  by another user. Journal writes and creation are fsynced. Torn/corrupt tails,
  replay and a crash after intent never permit another effect.
- `sourceInventory(repository, source)` freezes a **40-character commit**, its raw
  commit object, complete Git tree, modes and blobs. `verifySource` reconstructs
  commit/tree identities and verifies every frozen file before importing the
  registry. This version requires exactly 048 at the end and 044 as the prefix.
- `createIO`, `createRestorer`, `createBackup`, `createHosted` and `createWindow`
  reuse the existing mechanisms with explicit source/custody context. Low-level
  factories are not production authorization. Use `loadInstallation()` and its
  `migration`/`qualify` boundaries for production operations.
- `createMigrationOperator` consumes one source/manifest/backup/plan-bound command
  and journals intent before the real NOWAIT barrier. It verifies owner identity,
  TLS, PG version, stopped writers, history, quiescence, original custody and
  preservation. Provider checks occur outside the SQL transaction. Unknown COMMIT
  stays uncertain; a known COMMIT with failed readback stays committed-unverified.
  `reconcile` is read-only and never consumes, appends, retries or reopens.
- Production owner identity checks acquire one physical database client and require
  its transport to be encrypted and certificate-authorized before querying identity
  on that same client. `pg_stat_ssl` behind a TLS-terminating proxy is not client
  transport evidence. Missing/plaintext/unverified client TLS fails closed; only
  owned local restore fixtures use the separate non-network fixture boundary.
- `createQualifier` independently verifies source, publication, action, command,
  expiry and backup custody; `consume:true` is exclusive and fsynced.
  `consume:false` requires matching existing consumption and never writes. The
  product CLI forwards this request for provider and database reconciliation.
- Provider inventories are bounded complete canonical **full raw rows**, detached
  and deeply frozen. Top/meta/links pagination, invalid totals/identities/types,
  duplicates and more than 1,000 rows fail closed. Archived empty inventories are
  valid. The controller carries its approved inventory into the actual CLI PUT
  boundary; every inner read compares against that baseline, including metadata.
- Before owner SQL (`admit`, `handoff`, `open-public`) the same app lock persists
  a SQL intent. Only canonical persisted phase/approval/evidence/hash readback
  finishes it. All provider/SQLite calls occur outside the bounded SQL transaction;
  its synchronous freshness guard covers both command and lease expiry.
- An unreleased lease remains quarantined after crash, boot change or expiry,
  even without an effect intent. Readback never clears it. A new command cannot
  silently reconcile an earlier intent, even at the target provider state.

The owner transaction retains 1500ms lock and 10000ms statement/transaction/idle
limits. Backup export holds only the necessary read-only exported snapshot during
`pg_dump`; it ends before encryption, provider reads or restoration. Dump and key
bytes use pipes, never argv, logs or plaintext files. Restore uses a pinned image,
network-none/tmpfs and disabled Docker/PostgreSQL logging. Runtime roles are never
elevated; temporary extension bootstrap exists only in an empty disposable cluster.
Scratch/staging roots are pinned with directory handles; replacement is rejected
before mount, extraction or import. Docker binds the socket directory's physical
path while PID 1 remains inert behind a private container-only FIFO. Before
releasing the official PostgreSQL entrypoint, the operator verifies the mounted
directory's device/inode against its retained handle and checks logging, network,
tmpfs and mount policy. A mismatched mount is stopped/removed without PostgreSQL
initialization. Every host PG client, returned socket path and owner database URL
uses the socket leaf's own retained directory handle, not its replaceable basename.
Cleanup uses that basename only after an inode check; a replaced leaf fails closed
without changing the replacement. Subprocesses
run beneath a Linux subreaper with pidfd-fenced descendant cleanup, including
new sessions/double forks. Timeout or uncertain cleanup is failure, never success.
GPG agents are scoped to the pinned private homedir; no host-wide kill is used.
After the scoped agent stop, cleanup removes only the four fixed, owned Unix
socket entries that refuse a connection. Observed active or uncertain sockets,
regular files, symlinks and identity changes fail closed. This accommodates GnuPG
versions that leave dead socket files after the supervised agent has been reaped;
it does not authorize stopping another homedir's agent or removing key material.
The caller must exclusively own use of this private homedir during cleanup.
The final identity check and unlink are separate syscalls; directory pinning does
not fence a concurrent same-UID writer swapping or activating a socket between them.

## Offline qualification

Install dependencies locally with `pnpm install --frozen-lockfile` (pnpm 10.33,
Node 24). Use only an explicitly owned output parent and the freshly verified pinned
Docker image; the runner does not pull/build images or load any credentials:

```sh
node ops/held-operator/rehearsal.mjs "$PWD" <immutable-40-character-source> <owned-private-output-parent>
node --test --test-concurrency=1 ops/held-operator/*.test.mjs
```

`GROVE_REHEARSAL_SOURCE=<exact commit>` selects the source for `fixture.test.mjs`;
its historical fallback is provisional, not final-source qualification. The runner
launches dependency-dependent tool checks from the installed repository, never
from the private artifact output parent. Their real subprocess evidence is retained
under the fixture output root. The nested checks remain inside fixture cleanup.
The runner also checks actual owner SQL COMMIT/lost acknowledgment against the
same SQLite app authority. After migration checks it opens a fresh configured
owner client, matching the separate production phase-command boundary rather
than retaining Knex's migration-disabled identifier processing. Parent runs the
real PG/image rehearsal and full gates serially.

The runner retains a unique private `fixture-*` directory containing the source
freeze, synthetic populated snapshots, catalog-delta blueprint, encrypted backup,
originals, receipt, journals and report. It tests actual 045–048, rollback on old-row
corruption, NOWAIT, statement/transaction timeouts, one real lost-ACK COMMIT,
provider drift/lost ACK, replay, torn journals, process crash, actual runtime-role
probes and cross-tenant denial. The report lists exact cases, code/dependency
source hashes and retained artifact hashes. Only count/hash metadata is persisted
for application rows. No retained production data is used by this runner.

This synthetic run is not a production-scale or retained-production-data
rehearsal. The parent must also qualify the final source against its authorized
populated restored custody, preserving its existing rows, catalog and originals;
the factories expose the same restore, blueprint and preservation operations for
that separate rehearsal. Do not edit a report's cases into passes, reuse a prior
source's blueprint, or treat the synthetic run as that separate evidence.

## Final freeze, independent review and installation

1. After accepted repair, the parent creates a **separate declaration-only PR**
   and coordinated stamp. This tooling change retires the inherited declaration;
   it never reanchors it. Rerun qualification on the parent's final immutable
   source. Development fixture reports cannot qualify another source or later
   edits. Operational code is separately pinned and need not be part of that app
   source's tree. Installed PG/Knex/Objection
   dependency source bytes are checked, not just lockfile/version strings.
2. Independently review the full evidence and final-source gates. With a private
   control root, call `inspectInstallation({control, config})`; it verifies source,
   code, dependencies, cases, every artifact, the actual before/after preservation
   proof, encrypted custody and completed backup journal. It returns `identity`
   without granting execution. `hashJSON(identity)` is the review subject.
3. An independently installed Ed25519 public verification key and signed review
   are required. Review payload: `{schema:1, contract:"source-bound-held-release-v1",
scope:"fixture"|"production", identity:<identity hash>, reviewer:<reviewer>,
issuedAt:<milliseconds>, expiresAt:<milliseconds>}`. Maximum validity is 24h.
   The signature is base64 over UTF-8 `canonical(payload)`. `fixture` never admits
   execution. Production scope is an explicit independent review decision, not a
   command flag. This package implements verification only: no signing operation,
   operational key creation/storage or new secret service. Test keys are ephemeral
   synthetic fixtures. The parent must establish the review authority separately;
   no production key, signature or live clearance is shipped.
   Expiry is checked against a fresh clock after artifact inspection and again
   after asynchronous source/authority/window verification, immediately before
   returning qualification. A review expiring during those checks is rejected.
4. Under the private root install `installation.json` and `review-key.pem` (0600).
   Set `GROVE_OPERATOR_CUSTODY_ROOT` to that root. Configuration fields:
   `schema:2`, `contract`, `sourceRoot` (the installed bundle's `admitted-source`),
   `inventory` (parsed source inventory), `report`, `blueprint`, `review` (private
   paths), `authority`, `window` and `policy`. Policy binds `appId`, `parentSession`, `deployedSource`,
   `deployedImage`, `originalsEncryptedSha256`, `originalsReviewDue`. Original
   review dates/hashes require the owner's actual retained-custody approval, not
   inferred defaults or an extension of retention. All referenced evidence must
   remain inside the private root. Run code from the complete reviewed source
   checkout; the adapter depends on that source's existing product controller.
5. A reviewed manifest still says `liveReadiness:false`: it does not prove an
   outage, provider console, lifecycle retry custody, remote acceptance, TLS,
   originals or a post-stop live backup. Parent supplies these separately. After
   its approved stop, use `observePlan` and `backup.captureQuiescentBackup` with
   `liveBackupTarget(url, io)`, the existing in-memory secret loader and actual
   original ciphertext. Parent-only approval retains the existing `backup-only`
   shape (UUID, source/manifest/plan/custody/generation hashes, ≤5-minute validity,
   outage approval and review date). Never relabel a fixture receipt as live.
6. Set configuration `live` to private `receipt`, `journal`, `ciphertext`,
   `originals`, `lifecycle`, `remote` paths and actual `heldAt`. Every command
   revalidates its custody, source/manifest, ciphertext and original review policy;
   migrations additionally recheck current held lifecycle/remote custody. A fresh
   migration backup must be no older than five minutes. No original bytes or
   provider/SQL uncertainty may be cleared to obtain admission.

## Local provisioning and recovery contract

These are explicit parent-admin operations, not steps performed automatically by
an ordinary open or this source change:

- `stageTrustedInstall({repository, inventory, destination})` materializes a new
  offline bundle: admitted source, all operator/product modules, concrete Node,
  transitive dependency layouts/resolutions and OS Python/module/shared-library
  hashes. It returns the raw `qualified-code.json` digest. No dependency install,
  privileged copy, signing or authority provisioning is hidden in staging.
- `authority-cli.mjs provision --request <private JSON> --out <new private JSON>`
  accepts `{root, workRoot, source, codeHash, id, custodyId}`. Directories already
  exist, are disjoint and private; UUIDs are owner-selected and `codeHash` is the
  reviewed bundle closure hash. It creates the initial schema-2 descriptor and
  retained independent `identity.json`. Existing DB/sidecars/identity are refused.
- Pin `hashJSON(appAuthorityIdentity(descriptor))` as `appAuthoritySha256` in the
  immutable trust file alongside `closureSha256` and `reviewKeySha256`. The global
  identity is `{schema,id,app,root,rootIdentity,dbIdentity}`. Installation-specific
  fields are `{source,codeHash,custodyId,workRoot,workIdentity}`; all are retained
  in SQLite. `installation.json.authority` is the complete registered descriptor.
- On a new source/bundle/custody, `authority-cli.mjs register` takes
  `{descriptor:<existing registration>, parameters:{source,codeHash,custodyId,workRoot}}`
  and writes the returned new registered descriptor to its new private work root.
  App authority identity stays unchanged. Registrations and historical effects
  are never deleted. This is not an authority reset/retirement path.
- `window` is `{certificate:<private path>, controls:<private path>}`. The signed
  certificate's payload fields are exactly `schema:1`,
  `kind:"cooperating-writer-window"`, UUID `id`, `authorityId`, `custodyId`,
  `manifest`, `source`, `app`, `digest`, `publication`, `ownerSession`, `issuedAt`,
  `expiresAt`, `leaseMs`, `controlsHash`, and
  `ownerQuiescence:"dashboard-and-other-writers-quiescent"`. Validity is at most
  15 minutes; leases are 1–300 seconds. Signature is Ed25519 over canonical payload.
  Controls bind `schema:1, authorityId, app, source, digest, ownerSession,
observedAt, validUntil, dashboardCustodian, pausedControllers:[{name,receipt}]`.
  Their canonical hash and actual operational exclusion require independent review.
- `reconcile` is read-only, including expired command/certificate readback. It
  neither renews a lease nor alters clock/journals/intent. Product `resolve` and
  migration `resolve` first perform canonical readback, then explicitly resolve
  only that authority intent. They never resend PUT/SQL. Resolution requires a
  **different, freshly signed exclusion certificate issued after the old one**.
  Product `resolve-idle` additionally requires no intent and the exact original
  command and observed state. Factories expose the same `window.resolveIdle` for
  backup/migration scratch recovery. Unknown outcomes remain held for investigation;
  no timeout, expiry, new source or matching target automatically reopens the app.

Parent-only entry points (help is safe; execution is not authorized by these
examples):

```sh
node ops/held-operator/authority-cli.mjs
node ops/held-operator/migration-cli.mjs
node scripts/release/held-operator-cli.mjs
```

The migration CLI's `plan --out <new private path>` writes a read-only observed
plan without overwriting an existing file. `execute|reconcile|resolve --request <private
JSON>` takes `{plan, approval}`. Migration approval fields are `schema:1`, UUID
`id`, `purpose:"migrate-045-048"`, `approved:true`, exact `source`, `manifest`,
`custody` (backup receipt hash), `planHash`, `issuedAt`, `expiresAt` (≤5 minutes).
No down migration, live restore, role/login manipulation, unconditional lease clearing, provider
retry, publication or ingress reopening exists in this migration entry point.
Product continuation retains its existing receipt chain and approval format.

Full root/release gates and independent review remain the parent's serialized
delivery responsibility. Passing these fixtures is not deployment acceptance.
