// Offline synthetic qualification runner. Never loads secrets, retained live
// evidence, production URLs or provider credentials. Outputs are fixture-only.
import assert from "node:assert/strict";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import {
  mkdtemp,
  mkdir,
  symlink,
  appendFile,
  readFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath, URL } from "node:url";
import { createControl, hashJSON, sha } from "./operator-control.mjs";
import {
  sourceInventory,
  verifySource,
  codeHashes,
  dependencyHashes,
  REQUIRED_CASES,
} from "./qualification.mjs";
import { runProcess, createIO } from "./operator-io.mjs";
import { createRestorer } from "./operator-restore.mjs";
import { createBackup, fixtureBackupTarget } from "./operator-backup.mjs";
import { createHosted } from "./operator-hosted.mjs";
import { readSnapshot } from "./catalog.mjs";
import {
  createWindow,
  preservationBlueprint,
  validatePreservation,
} from "./window-postgres.mjs";
import { boundedTransaction, barrierSql } from "./window-db.mjs";
import { createMigrationOperator } from "./window-policy.mjs";
import { rehearseOwnerSQL } from "./sql-rehearsal.mjs";
import { publication, receiptHash } from "../../scripts/release/held-state.mjs";
import {
  runProviderTransition,
  reconcileProviderTransition,
} from "../../scripts/release/held-operator.mjs";

// Shared with the dependency-resolution regression; returns actual subprocess
// evidence, never admission or caller-supplied pass flags.
export async function runRehearsalToolTests({
  repository,
  outputParent,
  tests,
} = {}) {
  const toolTests =
    tests ??
    [
      "authority.test.mjs",
      "authority-window.test.mjs",
      "authority-registration.test.mjs",
      "authority-sql.test.mjs",
      "window.test.mjs",
      "trusted-install.test.mjs",
      "process.test.mjs",
      "pinned-path.test.mjs",
      "restore-path.test.mjs",
      "rehearsal-path.test.mjs",
      "installation.test.mjs",
      "qualification.test.mjs",
    ].map((name) => fileURLToPath(new URL("./" + name, import.meta.url)));
  if (!tests)
    toolTests.push(
      ...[
        "held-instance-inventory.test.mjs",
        "held-operator-provider-io.test.mjs",
        "held-operator.test.mjs",
      ].map((name) =>
        fileURLToPath(
          new URL("../../scripts/release/" + name, import.meta.url),
        ),
      ),
    );
  const evidence = await runProcess(
    process.execPath,
    ["--test", "--test-concurrency=1", ...toolTests],
    undefined,
    { cwd: resolve(repository), maxBytes: 2 * 1024 * 1024, timeoutMs: 120000 },
  );
  await createControl(outputParent).durableWrite(
    outputParent + "/authority-window-install.tap",
    evidence,
  );
  return evidence;
}

export async function rehearse({
  repository,
  source,
  outputParent = resolve(
    repository,
    "../../plans/grove/release-recovery/operator-fixtures",
  ),
} = {}) {
  const started = Date.now();
  await mkdir(outputParent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(outputParent + "/fixture-"),
    control = createControl(root),
    sourceRoot = root + "/source";
  await mkdir(sourceRoot, { mode: 0o700 });
  const archive = await runProcess("git", ["archive", source], undefined, {
    cwd: repository,
    maxBytes: 128 * 1024 * 1024,
  });
  await runProcess("tar", ["-x", "-C", sourceRoot], archive);
  await symlink(
    repository + "/lib/database/node_modules",
    sourceRoot + "/lib/database/node_modules",
  );
  const inventory = sourceInventory(repository, source),
    verified = await verifySource(sourceRoot, inventory);
  const { createDatabase, probeDatabase } = await import(
    "file://" + sourceRoot + "/lib/database/src/index.ts"
  );
  const localManifest = {
    schema: 1,
    source,
    hash: hashJSON(inventory),
    executionAdmitted: false,
    fixtureOnly: true,
  };
  const io = createIO({
    control,
    sourceRoot,
    manifest: async () => localManifest,
  });
  const origin = createRestorer({ control, sourceRoot, crypt: io.crypt });
  const restoreRoot = await mkdtemp(outputParent + "/r-");
  const restore = createRestorer({
    control: createControl(restoreRoot),
    sourceRoot,
    crypt: io.crypt,
  });
  const key = "synthetic-fixture-only-encryption-key-not-a-production-secret";
  let fixture, db, server, before, backupResult, blueprint;
  const cases = {},
    artifacts = {};
  const connectDatabase = (user = "grove_owner") =>
    createDatabase(
      `postgresql://${user}@localhost/grove_restore?host=${encodeURIComponent(fixture.socketPath)}`,
      { max: 1, statementTimeoutMs: 10000 },
    );
  try {
    const toolEvidence = await runRehearsalToolTests({
      repository,
      outputParent: root,
    });
    artifacts[root + "/authority-window-install.tap"] = sha(toolEvidence);
    cases.sqlite_authority = "pass";
    cases.cooperating_window = "pass";
    cases.trusted_install = "pass";
    fixture = await origin.createRestoreFixture();
    db = await fixture.ownerDatabase();
    const first44 = {
      ...verified.migrationSource,
      getMigrations: async () => verified.migrations.slice(0, 44),
    };
    await db.migrate.latest({ migrationSource: first44 });
    let admin = fixture.connect();
    await admin.connect();
    try {
      await admin.query(
        "CREATE ROLE grove_api LOGIN NOSUPERUSER NOBYPASSRLS; CREATE ROLE grove_jobs LOGIN NOSUPERUSER NOBYPASSRLS; GRANT grove_runtime TO grove_api; GRANT grove_worker TO grove_jobs",
      );
    } finally {
      await admin.end();
    }
    const accounts = [];
    for (let i = 0; i < 2; i++) {
      const id = (
        await db.raw("SELECT id FROM grove_account(?)", [
          "fixture_subject_" + i,
        ])
      ).rows[0].id;
      accounts.push(id);
      const memory = randomUUID(),
        project = randomUUID();
      await db.raw(
        "INSERT INTO projects(id,account_id,name,identity) VALUES(?,?,?,?)",
        [project, id, "Synthetic notebook " + i, "fixture-" + i],
      );
      await db.raw(
        "INSERT INTO memories(id,account_id,project_id,kind,content,source) VALUES(?,?,?,'fact',?,'{}')",
        [memory, id, project, "Synthetic retained row " + i],
      );
      await db.raw(
        "INSERT INTO memory_revisions(account_id,memory_id,version,content,source) VALUES(?,?,1,?,'{}')",
        [id, memory, "Synthetic retained row " + i],
      );
      await db.raw(
        "INSERT INTO billing_customers(account_id,customer_id) VALUES(?,?)",
        [id, "cus_fixture_" + i],
      );
      await db.raw(
        "INSERT INTO billing_subscriptions(id,account_id,customer_id,price_id,status,period_end) VALUES(?,?,?,'price_fixture','canceled',now())",
        ["sub_fixture_" + i, id, "cus_fixture_" + i],
      );
      if (i === 0)
        await db.raw(
          "INSERT INTO media_objects(account_id,id,memory_id,mime,bytes,sha256,status,object_key,lease_id,lease_until,width,height) VALUES(?,?,?,'image/png',?,?, 'ready','fixture/original',?,now(),1,1)",
          [
            id,
            randomUUID(),
            memory,
            9,
            sha(Buffer.from("synthetic")),
            randomUUID(),
          ],
        );
    }
    before = await readSnapshot(db);
    await control.durableWrite(root + "/before.json", JSON.stringify(before));
    artifacts[root + "/before.json"] = sha(
      await readFile(root + "/before.json"),
    );
    // Generate the exact new-source catalog delta by executing actual migrations
    // in a transaction which is deliberately rolled back, not by hand-authoring
    // permissive object-name predicates.
    const rollback = Error("FIXTURE_BLUEPRINT_ROLLBACK");
    await assert.rejects(
      db.transaction(async (trx) => {
        await trx.migrate.latest({ migrationSource: verified.migrationSource });
        blueprint = preservationBlueprint(
          source,
          verified.registry,
          before,
          await readSnapshot(trx, before.columns),
        );
        throw rollback;
      }),
      (e) => e === rollback,
    );
    await control.durableWrite(
      root + "/blueprint.json",
      JSON.stringify(blueprint, null, 2) + "\n",
    );
    artifacts[root + "/blueprint.json"] = sha(
      await readFile(root + "/blueprint.json"),
    );
    const unchanged = async () => {
      const current = await readSnapshot(db);
      assert.equal(current.catalogHash, before.catalogHash);
      assert.equal(current.rowsetsHash, before.rowsetsHash);
    };
    const window = createWindow({
      source: verified,
      blueprint,
      verify: async () => {
        await verifySource(sourceRoot, inventory);
      },
    });
    // Real NOWAIT contention; the adapter must not terminate the holder.
    const holder = fixture.connect("grove_restore", "grove_owner");
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(barrierSql(before.tables));
      await assert.rejects(
        window.applyUnderBarrier(db, before),
        (e) => e.code === "55P03",
      );
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
    await unchanged();
    cases.nowait = "pass";
    await assert.rejects(
      boundedTransaction(db, async (trx) => {
        await trx.raw("SET LOCAL statement_timeout='25ms'");
        await trx.raw("SELECT pg_sleep(0.1)");
      }),
      (e) => e.code === "57014",
    );
    await unchanged();
    cases.statement_timeout = "pass";
    await assert.rejects(
      boundedTransaction(db, async (trx) => {
        await trx.raw("SET LOCAL statement_timeout='20s'");
        await trx.raw("SELECT pg_sleep(11)");
      }),
      (e) => e.code === "25P04" || /transaction timeout/.test(e.message),
    );
    await unchanged();
    cases.transaction_timeout = "pass";
    // A real COMMIT with its acknowledgement deliberately lost. No rollback or
    // retry is allowed after commit dispatch; inspect actual canonical state.
    let commits = 0,
      rollbacks = 0;
    const lost = {
      transaction: async () => {
        const trx = await db.transaction(),
          commit = trx.commit.bind(trx),
          rollback = trx.rollback.bind(trx);
        trx.commit = async () => {
          commits++;
          await commit();
          throw Error("fixture lost ack");
        };
        trx.rollback = async () => {
          rollbacks++;
          return rollback();
        };
        return trx;
      },
    };
    await assert.rejects(
      boundedTransaction(lost, (trx) =>
        trx.raw("CREATE TABLE fixture_lost_ack(id integer)"),
      ),
      (e) => e.code === "COMMIT_UNKNOWN",
    );
    assert.equal(commits, 1);
    assert.equal(rollbacks, 0);
    assert.equal(
      (await db.raw("SELECT to_regclass('public.fixture_lost_ack') AS name"))
        .rows[0].name,
      "fixture_lost_ack",
    );
    await db.raw("DROP TABLE fixture_lost_ack");
    await unchanged();
    cases.lost_commit_ack = "pass";
    // Corrupt an existing row inside the real migration transaction: full
    // preservation rejects it and all four DDL/history changes roll back.
    await assert.rejects(
      boundedTransaction(db, async (trx) => {
        await trx.migrate.latest({ migrationSource: verified.migrationSource });
        await trx.raw("UPDATE memories SET content='fixture corruption'");
        validatePreservation(
          before,
          await readSnapshot(trx, before.columns),
          blueprint,
        );
      }),
      /PRESERVATION_ROWS_DRIFT/,
    );
    await unchanged();
    const appId = "3aef47f9-3724-4f21-9cad-8c4eb5644af0",
      deployment = "22222222-2222-4222-8222-222222222222",
      image =
        "sha256:083e2eb0fc6598b70ed67d2f917c77a831dd8851bd00922fcaa493ec29451fb6";
    const spec = {
      name: "grove",
      maintenance: { enabled: true, archive: true },
      services: [
        {
          name: "api",
          image: {
            digest: image,
            registry_type: "DOCKER_HUB",
            registry: "miniaxolotl",
            repository: "grove",
          },
          run_command: "node dist/server.js",
          termination: { grace_period_seconds: 120 },
        },
      ],
      workers: [
        {
          name: "worker",
          image: {
            digest: image,
            registry_type: "DOCKER_HUB",
            registry: "miniaxolotl",
            repository: "grove",
          },
          run_command: "node dist/worker.js",
          termination: { grace_period_seconds: 120 },
        },
      ],
    };
    let drift = false,
      providerWrites = 0,
      settings = "1".repeat(64);
    server = createServer((req, res) => {
      if (req.method === "PUT") {
        providerWrites++;
        settings = hashJSON({ fixture: "held" });
        req.socket.destroy();
        return;
      }
      if (req.url === "/state") {
        res.end(JSON.stringify({ state: settings, settings, instances: [] }));
        return;
      }
      const current = drift ? { ...spec, region: "changed" } : spec;
      const body = req.url.endsWith("/instances")
        ? { instances: [] }
        : req.url.includes("/deployments/")
          ? { deployment: { id: deployment, phase: "ACTIVE", spec: current } }
          : {
              app: {
                id: appId,
                spec: current,
                active_deployment: { id: deployment, phase: "ACTIVE" },
              },
            };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const hosted = createHosted({
      appId,
      deployedImage: image,
      deployedSource: "9ee71cc987a443c020fbf6030f76664b4cc5e914",
    });
    const observe = () =>
      hosted({ token: "synthetic-loopback-only", baseURL, fixture: true });
    const held = await observe(),
      now = Date.now(),
      parentSession = "synthetic-fixture-parent";
    const common = {
      schema: 1,
      appId,
      heldSpecHash: held.fingerprint,
      heldDeploymentId: deployment,
      verifiedBy: parentSession,
      observedAt: now,
      validUntil: now + 300000,
    };
    const lifecycle = {
      ...common,
      kind: "lifecycle-custody",
      identity: { non2xx: true, retryCustody: true, backlogRetained: true },
      billing: { non2xx: true, retryCustody: true, backlogRetained: true },
    };
    const remote = {
      ...common,
      kind: "remote-reconciliation",
      inflight: 0,
      uncertain: 0,
      providers: ["identity", "billing", "mail", "models", "storage"],
    };
    const plan = {
      source,
      manifestHash: localManifest.hash,
      observedAt: now,
      provider: held,
      database: {
        catalogHash: before.catalogHash,
        rowsetsHash: before.rowsetsHash,
        mediaHash: before.mediaHash,
        historyHash: hashJSON(before.metadata.history),
      },
    };
    const originalsEncrypted = await io.crypt(
      Buffer.from(
        JSON.stringify({
          originals: [
            {
              object_key: "fixture/original",
              data: Buffer.from("synthetic").toString("base64"),
              sha256: sha(Buffer.from("synthetic")),
              bytes: 9,
            },
          ],
        }),
      ),
      key,
    );
    await control.durableWrite(root + "/originals.gpg", originalsEncrypted);
    artifacts[root + "/originals.gpg"] = sha(originalsEncrypted);
    const reviewDue = new Date(now + 86400000).toISOString().slice(0, 10);
    const approval = {
      schema: 1,
      id: randomUUID(),
      source,
      manifestHash: localManifest.hash,
      planHash: hashJSON(plan),
      parentSession,
      approved: true,
      outageApproved: true,
      purpose: "backup-only",
      fixtureOnly: true,
      method: "archive-all",
      issuedAt: now,
      expiresAt: now + 300000,
      heldAt: now - 1000,
      heldSpecHash: held.fingerprint,
      heldDeploymentId: deployment,
      lifecycleHash: hashJSON(lifecycle),
      remoteHash: hashJSON(remote),
      originalsHash: sha(originalsEncrypted),
      originalsReviewDue: reviewDue,
    };
    const backup = createBackup({
      control,
      source: verified,
      manifest: async () => localManifest,
      parentSession,
      appId,
      originalsReviewDue: reviewDue,
      crypt: io.crypt,
      restoreEncryptedBackup: restore.restoreEncryptedBackup,
    });
    // Release the owner's pooled connection: quiescence rejects even idle owners.
    await db.destroy();
    db = null;
    const target = fixtureBackupTarget(fixture);
    const args = {
      plan,
      approval,
      manifestHash: localManifest.hash,
      lifecycle,
      remote,
      originalsEncrypted,
      key,
      target,
      observe,
    };
    const bad = await io.crypt(Buffer.from('{"originals":[]}'), key);
    await assert.rejects(
      backup.captureQuiescentBackup({
        ...args,
        approval: { ...approval, id: randomUUID(), originalsHash: sha(bad) },
        originalsEncrypted: bad,
      }),
      /ORIGINAL_CUSTODY_INCOMPLETE/,
    );
    cases.original_custody = "pass";
    await assert.rejects(
      backup.captureQuiescentBackup({
        ...args,
        approval: { ...approval, id: randomUUID() },
        target: fixtureBackupTarget(fixture, {
          afterDump: () => {
            drift = true;
          },
        }),
      }),
      /PROVIDER_DRIFT/,
    );
    drift = false;
    cases.provider_drift = "pass";
    backupResult = await backup.captureQuiescentBackup(args);
    assert(
      backupResult.receipt.fixtureOnly && backupResult.receipt.restoreVerified,
    );
    cases.backup_restore = "pass";
    await assert.rejects(
      backup.captureQuiescentBackup(args),
      /APPROVAL_ALREADY_CONSUMED/,
    );
    cases.replay = "pass";
    for (const path of [
      backupResult.path,
      backupResult.journal,
      root + "/backups/" + approval.id + "/receipt.json",
    ])
      artifacts[path] = sha(await readFile(path));
    db = await fixture.ownerDatabase();
    await unchanged();
    const migrationPlan = {
      source,
      manifestHash: localManifest.hash,
      before,
      provider: held,
    };
    const migrationApproval = {
      schema: 1,
      id: randomUUID(),
      purpose: "migrate-045-048",
      approved: true,
      source,
      manifest: localManifest.hash,
      custody: hashJSON(backupResult.receipt),
      planHash: hashJSON(migrationPlan),
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    let observed = 0,
      postCommitDrift = true;
    const migration = createMigrationOperator({
      control,
      source: verified,
      blueprint,
      scope: "fixture",
      manifest: async () => localManifest,
      verify: async () => {
        await verifySource(sourceRoot, inventory);
      },
      validateCustody: async (c) => {
        assert.equal(c.custody, hashJSON(backupResult.receipt));
        return backupResult.receipt;
      },
      observe: async () => {
        const state = await observe();
        return ++observed >= 3 && postCommitDrift
          ? { ...state, deploymentId: randomUUID() }
          : state;
      },
    });
    await assert.rejects(
      migration.execute({
        db,
        plan: migrationPlan,
        approval: migrationApproval,
      }),
      /PROVIDER_DRIFT/,
    );
    const migrationJournal =
      root + "/migration-journals/" + migrationApproval.id + ".jsonl";
    assert.equal(
      (await control.readJournal(migrationJournal)).last.state,
      "committed_unverified_hold",
    );
    postCommitDrift = false;
    const journalBytes = await readFile(migrationJournal);
    const reconciled = await migration.reconcile({
      db,
      plan: migrationPlan,
      approval: migrationApproval,
    });
    assert.equal(reconciled.applied.length, 4);
    assert.deepEqual(await readFile(migrationJournal), journalBytes);
    await assert.rejects(
      migration.execute({
        db,
        plan: migrationPlan,
        approval: migrationApproval,
      }),
      /APPROVAL_ALREADY_CONSUMED/,
    );
    const after = await readSnapshot(db, before.columns);
    validatePreservation(before, after, blueprint);
    cases.preservation_048 = "pass";
    await control.durableWrite(root + "/after.json", JSON.stringify(after));
    artifacts[root + "/after.json"] = sha(await readFile(root + "/after.json"));
    artifacts[migrationJournal] = sha(journalBytes);
    for (const role of ["grove_api", "grove_jobs"]) {
      const runtime = connectDatabase(role);
      try {
        await runtime.transaction(async (trx) => {
          await trx.raw("SET TRANSACTION READ ONLY");
          await probeDatabase(trx);
        });
        await runtime.transaction(async (trx) => {
          await trx.raw("SELECT set_config('grove.account_id',?,true)", [
            accounts[0],
          ]);
          for (const [table, column] of [
            ["accounts", "id"],
            ["projects", "account_id"],
            ["memories", "account_id"],
            ["memory_revisions", "account_id"],
            ["media_objects", "account_id"],
            ["billing_subscriptions", "account_id"],
          ])
            assert.equal(
              (
                await trx.raw(
                  `SELECT count(*)::integer AS n FROM ${table} WHERE ${column}=?`,
                  [accounts[1]],
                )
              ).rows[0].n,
              0,
            );
        });
      } finally {
        await runtime.destroy();
      }
    }
    cases.runtime_roles = "pass";
    cases.tenant_isolation = "pass";
    // Actual loopback lost provider ACK with durable file journals and exact
    // readback. The synthetic qualification below is fixture wiring only, never
    // emitted as an admitted production manifest.
    const syntheticContext = {
      repository: "miniaxolotl/grove",
      actor: "miniaxolotl",
      protected: true,
      source,
      production: "b".repeat(40),
      tree: inventory.tree,
      tag:
        "v" + JSON.parse(await readFile(sourceRoot + "/package.json")).version,
      apiVersion: JSON.parse(
        await readFile(sourceRoot + "/packages/api/package.json"),
      ).version,
      run: 123,
      attempt: 1,
    };
    const p = publication(
      syntheticContext,
      `sha256:${"d".repeat(64)}`,
      Date.now(),
    );
    const command = {
      schema: 1,
      id: randomUUID(),
      source,
      publication: receiptHash(p),
      parent: receiptHash(p),
      action: "restore",
      manifest: localManifest.hash,
      custody: "c".repeat(64),
      expected: settings,
      proposed: hashJSON({ fixture: "held" }),
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60000,
      approved: true,
    };
    const state = async () => {
      const r = await globalThis.fetch(baseURL + "/state");
      return r.json();
    };
    const transitionIO = {
      assertExclusiveWindow: async () => {}, // synthetic loopback fixture only
      qualify: async () => ({
        executionAdmitted: true,
        contract: "source-bound-held-release-v1",
        source,
        manifest: command.manifest,
        custody: command.custody,
      }),
      specFingerprint: hashJSON,
      getState: state,
      verify: state,
      journal: (id, initial) =>
        control.openJournal(root + "/transitions", id, initial),
      readJournal: (id) =>
        control.readJournal(root + "/transitions/" + id + ".jsonl"),
      put: async () => {
        await globalThis.fetch(baseURL + "/state", {
          method: "PUT",
          redirect: "error",
          signal: globalThis.AbortSignal.timeout(1000),
        });
      },
    };
    await assert.rejects(
      runProviderTransition(p, p, command, { fixture: "held" }, transitionIO),
      /uncertain/,
    );
    assert.equal(providerWrites, 1);
    await reconcileProviderTransition(p, p, command, transitionIO);
    assert.equal(providerWrites, 1);
    cases.provider_lost_ack = "pass";
    await assert.rejects(
      runProviderTransition(p, p, command, { fixture: "held" }, transitionIO),
      /APPROVAL_ALREADY_CONSUMED/,
    );
    assert.equal(providerWrites, 1);
    await appendFile(
      root + "/transitions/" + command.id + ".jsonl",
      '{"torn":',
    );
    await assert.rejects(
      reconcileProviderTransition(p, p, command, transitionIO),
      /Torn/,
    );
    assert.equal(providerWrites, 1);
    cases.torn_journal = "pass";
    const crashId = randomUUID();
    await assert.rejects(
      runProcess(process.execPath, [
        "--input-type=module",
        "-e",
        `import {createControl} from ${JSON.stringify(new URL("./operator-control.mjs", import.meta.url).href)};const j=await createControl(${JSON.stringify(root)}).openJournal(${JSON.stringify(root + "/crash")},${JSON.stringify(crashId)},{hold:true});await j.append('transaction_pending',{hold:true});process.exit(17)`,
      ]),
    );
    assert.equal(
      (await control.readJournal(root + "/crash/" + crashId + ".jsonl")).last
        .state,
      "transaction_pending",
    );
    await assert.rejects(
      control.openJournal(root + "/crash", crashId, { hold: true }),
      /ALREADY_CONSUMED/,
    );
    assert.equal(providerWrites, 1);
    cases.crash_before_effect = "pass";
    // Knex's migrator disables identifier/response processing on its client.
    // Real owner phase commands open a fresh configured database connection;
    // model that boundary instead of reusing the migration client's state.
    await db.destroy();
    db = await fixture.ownerDatabase();
    await rehearseOwnerSQL({
      db,
      root,
      source,
      manifest: localManifest,
      p,
      context: syntheticContext,
    });
    cases.owner_sql_window = "pass";
    for (const [path, hash] of Object.entries(artifacts))
      assert.equal(sha(await readFile(path)), hash);
  } finally {
    await db?.destroy();
    if (server) await new Promise((r) => server.close(r));
    await fixture?.close();
  }
  assert.deepEqual(Object.keys(cases).sort(), [...REQUIRED_CASES].sort());
  const report = {
    schema: 1,
    source,
    tree: inventory.tree,
    fixtureOnly: true,
    liveReadiness: false,
    toolchain: "PG17.12/vector0.8.0",
    registry: verified.registry,
    pending: verified.registry.slice(44),
    operatorFiles: await codeHashes(),
    dependencyFiles: await dependencyHashes(sourceRoot),
    blueprintHash: hashJSON(blueprint),
    cases,
    artifacts,
    snapshots: { before: root + "/before.json", after: root + "/after.json" },
    backup: {
      receipt: root + "/backups/" + backupResult.receipt.approvalHash,
      journal: backupResult.journal,
      ciphertext: backupResult.path,
      originals: root + "/originals.gpg",
    },
    tables: before.tables.length,
    rows: Object.values(before.rowsets).reduce((n, r) => n + r.count, 0),
    totalMs: Date.now() - started,
    finishedAt: new Date().toISOString(),
  };
  report.backup.receipt = backupResult.path.replace(
    /database\.dump\.gpg$/,
    "receipt.json",
  );
  await control.durableWrite(
    root + "/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await control.durableWrite(
    root + "/inventory.json",
    JSON.stringify(inventory, null, 2) + "\n",
  );
  return { ...report, root };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [repository, source, outputParent] = process.argv.slice(2);
    const r = await rehearse({
      repository: resolve(repository),
      source,
      outputParent: resolve(outputParent),
    });
    console.log(
      JSON.stringify({
        fixtureOnly: true,
        liveReadiness: false,
        source: r.source,
        root: r.root,
        cases: r.cases,
        totalMs: r.totalMs,
      }),
    );
  } catch {
    console.error(
      "Fixture qualification failed; no live admission. Inspect task-owned fixture evidence.",
    );
    process.exitCode = 1;
  }
}
