import { verify, createPublicKey, createHash } from "node:crypto";
import { readFile, lstat, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import { need, hashJSON, sha, canonical, uuid } from "./operator-control.mjs";
import {
  assertImmutableCode,
  assertBundledSource,
} from "../../scripts/release/held-operator-bootstrap.mjs";
import { validateConfig } from "./config.mjs";
import { openAuthority } from "./authority.mjs";
import { verifyWindow } from "./window.mjs";
import {
  validatePreservation,
  preservationBlueprint,
} from "./window-postgres.mjs";
export const CONTRACT = "source-bound-held-release-v1";
export const OLD_SOURCE = "cd2a61a8f489dc4516613975822d944c99f06e0a";
export const REQUIRED_CASES = Object.freeze([
  "backup_restore",
  "original_custody",
  "preservation_048",
  "runtime_roles",
  "tenant_isolation",
  "nowait",
  "statement_timeout",
  "transaction_timeout",
  "lost_commit_ack",
  "provider_drift",
  "provider_lost_ack",
  "replay",
  "torn_journal",
  "crash_before_effect",
  "sqlite_authority",
  "cooperating_window",
  "trusted_install",
  "owner_sql_window",
]);
export const operatorRoot = fileURLToPath(new URL(".", import.meta.url));
const gitHash = (kind, bytes) =>
  createHash("sha1")
    .update(Buffer.concat([Buffer.from(`${kind} ${bytes.length}\0`), bytes]))
    .digest("hex");
export function inventoryTree(files) {
  const root = new Map();
  for (const [path, record] of Object.entries(files)) {
    need(
      !path.startsWith("/") &&
        !path.split("/").some((p) => p === ".." || p === "." || !p),
      "SOURCE_PATH_REJECTED",
    );
    need(
      ["100644", "100755"].includes(record?.mode) &&
        /^[a-f0-9]{40}$/.test(record?.blob ?? ""),
      "SOURCE_ENTRY_REJECTED",
    );
    const parts = path.split("/");
    let dir = root;
    for (const segment of parts.slice(0, -1)) {
      if (!dir.has(segment)) dir.set(segment, new Map());
      need(dir.get(segment) instanceof Map, "SOURCE_TREE_REJECTED");
      dir = dir.get(segment);
    }
    need(!dir.has(parts.at(-1)), "SOURCE_TREE_REJECTED");
    dir.set(parts.at(-1), record);
  }
  const hash = (dir) => {
    const entries = [...dir].sort(([a, aa], [b, bb]) =>
      Buffer.compare(
        Buffer.from(a + (aa instanceof Map ? "/" : "")),
        Buffer.from(b + (bb instanceof Map ? "/" : "")),
      ),
    );
    return gitHash(
      "tree",
      Buffer.concat(
        entries.map(([name, value]) =>
          Buffer.concat([
            Buffer.from(
              `${value instanceof Map ? "40000" : value.mode} ${name}\0`,
            ),
            Buffer.from(value instanceof Map ? hash(value) : value.blob, "hex"),
          ]),
        ),
      ),
    );
  };
  return hash(root);
}
export async function codeHashes() {
  const files = {};
  for (const name of (await readdir(operatorRoot))
    .filter((n) => n.endsWith(".mjs") || n.endsWith(".py"))
    .sort())
    files[name] = sha(await readFile(join(operatorRoot, name)));
  const productRoot = resolve(operatorRoot, "../..");
  const release = join(productRoot, "scripts/release");
  for (const name of (await readdir(release))
    .filter((n) => n.endsWith(".mjs") || n === "held-console.py")
    .sort())
    files["product/scripts/release/" + name] = sha(
      await readFile(join(release, name)),
    );
  for (const path of [
    "scripts/deploy-digitalocean.mjs",
    "scripts/ci/github-json.mjs",
  ])
    files["product/" + path] = sha(await readFile(join(productRoot, path)));
  return files;
}
export async function dependencyHashes(sourceRoot) {
  const files = {},
    seen = new Set();
  async function visit(name, from, optional = false) {
    let entry;
    try {
      entry = createRequire(from).resolve(name);
    } catch (e) {
      if (optional && e.code === "MODULE_NOT_FOUND") return;
      throw e;
    }
    let root = dirname(entry),
      pkg;
    for (;;) {
      try {
        const candidate = JSON.parse(await readFile(root + "/package.json"));
        if (candidate.name === name) {
          pkg = candidate;
          break;
        }
      } catch {
        // Continue upwards until the resolved dependency's own manifest.
      }
      need(root !== dirname(root), "DEPENDENCY_ROOT_REJECTED");
      root = dirname(root);
    }
    if (seen.has(root)) return;
    seen.add(root);
    const prefix = pkg.name + "@" + pkg.version + "/";
    async function walk(dir, path = "") {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.name === "node_modules") continue;
        need(!item.isSymbolicLink(), "DEPENDENCY_SYMLINK_REJECTED");
        if (item.isDirectory())
          await walk(join(dir, item.name), path + item.name + "/");
        else {
          need(item.isFile(), "DEPENDENCY_ENTRY_REJECTED");
          const key = prefix + path + item.name,
            hash = sha(await readFile(join(dir, item.name)));
          need(
            !files[key] || files[key] === hash,
            "DEPENDENCY_DUPLICATE_DRIFT",
          );
          files[key] = hash;
        }
      }
    }
    await walk(root);
    for (const dependency of Object.keys(pkg.dependencies ?? {}))
      await visit(dependency, root + "/package.json");
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {}))
      if (!pkg.dependencies?.[dependency])
        await visit(dependency, root + "/package.json", true);
  }
  for (const name of ["pg", "knex", "objection"])
    await visit(name, resolve(sourceRoot, "lib/database/package.json"));
  return files;
}
export function sourceInventory(repository, source) {
  need(
    /^[a-f0-9]{40}$/.test(source) && source !== OLD_SOURCE,
    "SOURCE_REJECTED",
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  const tree = git("rev-parse", source + "^{tree}"),
    files = {};
  const records = execFileSync("git", ["ls-tree", "-rz", source], {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  for (const record of records) {
    const match = /^(100(?:644|755)) blob ([a-f0-9]{40})\t(.+)$/s.exec(record);
    need(match, "SOURCE_ENTRY_REJECTED");
    files[match[3]] = { mode: match[1], blob: match[2] };
  }
  const commit = execFileSync("git", ["cat-file", "commit", source], {
    cwd: repository,
    maxBuffer: 1024 * 1024,
  }).toString("base64");
  need(
    Object.keys(files).length > 0 && inventoryTree(files) === tree,
    "SOURCE_TREE_REJECTED",
  );
  return { source, tree, commit, files };
}
export async function verifySource(
  sourceRoot,
  inventory,
  { load = true } = {},
) {
  need(
    inventory?.source !== OLD_SOURCE &&
      /^[a-f0-9]{40}$/.test(inventory?.source ?? "") &&
      /^[a-f0-9]{40}$/.test(inventory.tree ?? ""),
    "SOURCE_REJECTED",
  );
  const commit = Buffer.from(inventory.commit ?? "", "base64");
  need(
    commit.length <= 1024 * 1024 &&
      gitHash("commit", commit) === inventory.source &&
      commit.toString().startsWith("tree " + inventory.tree + "\n"),
    "SOURCE_COMMIT_REJECTED",
  );
  // The full Git tree inventory is supplied by the independently reviewed freeze.
  const files = inventory.files;
  need(
    files &&
      Object.keys(files).length > 0 &&
      inventoryTree(files) === inventory.tree,
    "SOURCE_TREE_REJECTED",
  );
  for (const [path, { blob }] of Object.entries(files)) {
    need(
      !path.startsWith("/") &&
        !path.split("/").some((p) => p === ".." || p === "." || !p),
      "SOURCE_PATH_REJECTED",
    );
    let current = resolve(sourceRoot);
    for (const part of path.split("/")) {
      current = join(current, part);
      need(!(await lstat(current)).isSymbolicLink(), "SOURCE_SYMLINK_REJECTED");
    }
    const bytes = await readFile(current);
    need(gitHash("blob", bytes) === blob, "SOURCE_DRIFT");
  }
  if (!load) return { source: inventory.source, tree: inventory.tree };
  const { migrations, migrationSource } = await import(
    new URL(
      "lib/database/src/migrations.ts",
      "file://" + resolve(sourceRoot) + "/",
    ).href
  );
  const registry = migrations.map((m) => m.name);
  need(
    registry.length === 48 &&
      registry[47] === "20261119_048_lifecycle_reconciliation",
    "REGISTRY_DRIFT",
  );
  return {
    source: inventory.source,
    tree: inventory.tree,
    registry,
    migrations,
    migrationSource,
  };
}
export async function verifyReview({
  review,
  publicKey,
  identity,
  now = Date.now(),
}) {
  need(
    review?.payload?.schema === 1 && review.payload.contract === CONTRACT,
    "REVIEW_REQUIRED",
  );
  const p = review.payload;
  need(
    p.identity === hashJSON(identity) &&
      ["fixture", "production"].includes(p.scope) &&
      typeof p.reviewer === "string" &&
      p.reviewer.length > 0,
    "REVIEW_BINDING_REJECTED",
  );
  need(
    Number.isSafeInteger(p.issuedAt) &&
      Number.isSafeInteger(p.expiresAt) &&
      p.issuedAt <= now &&
      p.expiresAt > now &&
      p.expiresAt - p.issuedAt <= 86400000,
    "REVIEW_EXPIRED",
  );
  const key = createPublicKey(publicKey);
  need(key.asymmetricKeyType === "ed25519", "REVIEW_KEY_REJECTED");
  need(
    verify(
      null,
      Buffer.from(canonical(p)),
      key,
      Buffer.from(review.signature ?? "", "base64"),
    ),
    "REVIEW_SIGNATURE_REJECTED",
  );
  return p;
}
export async function verifyFixtureEvidence({
  control,
  report,
  blueprint,
  source,
}) {
  need(
    report?.snapshots?.before &&
      report.snapshots.after &&
      report.backup?.receipt &&
      report.backup.journal &&
      report.backup.ciphertext &&
      report.backup.originals,
    "FIXTURE_EVIDENCE_REQUIRED",
  );
  const before = await control.readPrivate(report.snapshots.before),
    after = await control.readPrivate(report.snapshots.after);
  need(
    hashJSON(before.metadata.history.map((r) => r.name)) ===
      hashJSON(source.registry.slice(0, 44)),
    "FIXTURE_HISTORY_DRIFT",
  );
  validatePreservation(before, after, blueprint);
  need(
    hashJSON(
      preservationBlueprint(source.source, source.registry, before, after),
    ) === hashJSON(blueprint),
    "FIXTURE_BLUEPRINT_DRIFT",
  );
  const receipt = await control.readPrivate(report.backup.receipt),
    journal = await control.readJournal(report.backup.journal, {
      fixtureEvidence: true,
    });
  const ciphertext = await control.readPrivate(report.backup.ciphertext, {
    json: false,
    max: 256 * 1024 * 1024,
  });
  const originals = await control.readPrivate(report.backup.originals, {
    json: false,
    max: 256 * 1024 * 1024,
  });
  need(
    receipt.schema === 1 &&
      receipt.source === source.source &&
      receipt.purpose === "quiescent-backup-only" &&
      receipt.fixtureOnly === true &&
      receipt.migrationExecution === false &&
      receipt.readbackVerified === true &&
      receipt.restoreVerified === true &&
      receipt.quiescenceVerified === true,
    "FIXTURE_BACKUP_REJECTED",
  );
  need(
    receipt.encryptedSha256 === sha(ciphertext) &&
      receipt.originalsHash === sha(originals) &&
      receipt.restore?.isolatedNetwork === "none" &&
      receipt.restore.storage === "tmpfs" &&
      receipt.restore.logDriver === "none" &&
      receipt.restore.metadataStripped === false &&
      receipt.restore.cleanupVerified === true,
    "FIXTURE_RESTORE_REJECTED",
  );
  need(
    ["catalogHash", "rowsetsHash", "mediaHash"].every(
      (k) => receipt[k] === before[k],
    ),
    "FIXTURE_BACKUP_DRIFT",
  );
  need(
    !journal.requiresReconciliation &&
      journal.records.some(
        (r) =>
          r.state === "backup_complete_hold" &&
          r.backupReceiptHash === hashJSON(receipt) &&
          r.backupHash === sha(ciphertext),
      ),
    "FIXTURE_BACKUP_JOURNAL_REJECTED",
  );
}
export async function inspectInstallation({ control, config }) {
  need(
    config?.schema === 2 &&
      config.contract === CONTRACT &&
      !config.hardBlock &&
      config.inventory?.source !== OLD_SOURCE,
    "OPERATOR_NOT_QUALIFIED",
  );
  config = JSON.parse(JSON.stringify(config));
  validateConfig(config);
  const frozen = await verifySource(config.sourceRoot, config.inventory, {
      load: false,
    }),
    operatorFiles = await codeHashes(),
    dependencyFiles = await dependencyHashes(config.sourceRoot);
  const report = await control.readPrivate(config.report),
    blueprint = await control.readPrivate(config.blueprint);
  need(
    Array.isArray(report.registry) &&
      report.registry.length === 48 &&
      report.registry[47] === "20261119_048_lifecycle_reconciliation",
    "REGISTRY_DRIFT",
  );
  const source = { ...frozen, registry: report.registry };
  need(
    report.schema === 1 &&
      report.fixtureOnly === true &&
      report.liveReadiness === false,
    "FIXTURE_REPORT_REQUIRED",
  );
  need(
    report.source === source.source &&
      report.tree === source.tree &&
      hashJSON(report.registry) === hashJSON(source.registry),
    "REPORT_SOURCE_DRIFT",
  );
  need(
    hashJSON(report.operatorFiles) === hashJSON(operatorFiles),
    "OPERATOR_CODE_DRIFT",
  );
  need(
    hashJSON(report.dependencyFiles) === hashJSON(dependencyFiles),
    "DEPENDENCY_SOURCE_DRIFT",
  );
  need(
    blueprint.source === source.source &&
      hashJSON(blueprint.registry) === hashJSON(source.registry) &&
      report.blueprintHash === hashJSON(blueprint),
    "BLUEPRINT_DRIFT",
  );
  need(
    hashJSON(Object.keys(report.cases).sort()) ===
      hashJSON([...REQUIRED_CASES].sort()) &&
      Object.values(report.cases).every((v) => v === "pass"),
    "FIXTURE_CASES_INCOMPLETE",
  );
  need(
    report.toolchain === "PG17.12/vector0.8.0" &&
      report.tables >= 80 &&
      report.rows > 0,
    "FIXTURE_SCOPE_REJECTED",
  );
  need(
    report.artifacts && Object.keys(report.artifacts).length >= 3,
    "FIXTURE_ARTIFACTS_REQUIRED",
  );
  for (const [path, hash] of Object.entries(report.artifacts))
    need(
      sha(
        await control.readPrivate(path, {
          json: false,
          max: 256 * 1024 * 1024,
        }),
      ) === hash,
      "FIXTURE_ARTIFACT_DRIFT",
    );
  await verifyFixtureEvidence({ control, report, blueprint, source });
  need(
    config.policy && typeof config.policy === "object",
    "INSTALLATION_POLICY_REQUIRED",
  );
  const identity = {
    schema: 1,
    contract: CONTRACT,
    source: source.source,
    tree: source.tree,
    sourceFiles: config.inventory.files,
    operatorFiles,
    dependencyFiles,
    registry: source.registry,
    blueprintHash: hashJSON(blueprint),
    reportHash: hashJSON(report),
    policy: config.policy,
    authority: config.authority,
  };
  return { identity, source, blueprint };
}
export async function qualifyInstallation({
  control,
  config,
  publicKey,
  now = Date.now,
  readOnly = false,
}) {
  config = JSON.parse(JSON.stringify(config));
  const { identity, source, blueprint } = await inspectInstallation({
    control,
    config,
  });
  const signedReview = await control.readPrivate(config.review);
  const review = await verifyReview({
    review: signedReview,
    publicKey,
    identity,
    now: now(),
  });
  if (review.scope === "production") {
    assertBundledSource(operatorRoot, config.sourceRoot);
    for (const path of Object.keys(config.inventory.files))
      await assertImmutableCode(join(config.sourceRoot, path));
    need(
      /^sha256:[a-f0-9]{64}$/.test(config.policy.deployedImage ?? "") &&
        /^[a-f0-9]{40}$/.test(config.policy.deployedSource ?? "") &&
        /^[a-f0-9]{64}$/.test(config.policy.originalsEncryptedSha256 ?? "") &&
        /^\d{4}-\d{2}-\d{2}$/.test(config.policy.originalsReviewDue ?? ""),
      "PRODUCTION_CUSTODY_POLICY_REQUIRED",
    );
    need(
      !resolve(control.root).startsWith(resolve(config.sourceRoot) + "/") &&
        resolve(control.root) !== resolve(config.sourceRoot),
      "PRIVATE_CUSTODY_IN_SOURCE",
    );
  }
  const loaded = await verifySource(config.sourceRoot, config.inventory);
  need(
    hashJSON(loaded.registry) === hashJSON(source.registry),
    "REGISTRY_DRIFT",
  );
  const manifest = {
    ...identity,
    hash: hashJSON(identity),
    reviewQualified: review.scope === "production",
    executionAdmitted: false,
    readOnly,
    fixtureQualified: true,
    liveReadiness: false,
    reviewer: review.reviewer,
  };
  if (review.scope === "production") {
    need(
      config.authority &&
        config.authority.workRoot === control.root &&
        config.authority.source === source.source,
      "AUTHORITY_INSTALLATION_BINDING",
    );
    for (const privateRoot of [control.root, config.authority.root])
      for (const codeRoot of [
        config.sourceRoot,
        resolve(operatorRoot, "../.."),
      ]) {
        const a = resolve(privateRoot),
          b = resolve(codeRoot);
        need(
          a !== b && !a.startsWith(b + "/") && !b.startsWith(a + "/"),
          "AUTHORITY_OR_CUSTODY_IN_CODE",
        );
      }
    const authority = openAuthority(config.authority);
    await authority.status();
    await verifyWindow({
      control,
      authority,
      manifest,
      policy: config.policy,
      config: config.window,
      publicKey,
      readOnly,
    });
    manifest.executionAdmitted = true;
  }
  await verifyReview({ review: signedReview, publicKey, identity, now: now() });
  // No private archive is needed for fixture admission. Live backup custody is
  // revalidated separately at each consumption, never inherited from this report.
  return { manifest, source: loaded, blueprint };
}
export function createQualifier({
  control,
  manifest,
  validateCustody,
  now = Date.now,
}) {
  return async (scope, { command } = {}) => {
    scope = JSON.parse(JSON.stringify(scope));
    command = JSON.parse(JSON.stringify(command));
    const fresh = await manifest();
    need(
      fresh.executionAdmitted === true &&
        (!scope.consume || !fresh.readOnly) &&
        !fresh.hardBlock &&
        fresh.source !== OLD_SOURCE &&
        fresh.contract === CONTRACT,
      "OPERATOR_NOT_QUALIFIED",
    );
    need(
      typeof scope?.consume === "boolean" && uuid(command?.id),
      "QUALIFICATION_REQUEST_REJECTED",
    );
    const at = now();
    need(
      command.schema === 1 &&
        command.approved === true &&
        Number.isSafeInteger(command.issuedAt) &&
        Number.isSafeInteger(command.expiresAt) &&
        command.issuedAt <= at &&
        command.expiresAt > command.issuedAt &&
        command.expiresAt - command.issuedAt <= 300000 &&
        (!scope.consume || command.expiresAt > at),
      "QUALIFICATION_APPROVAL_EXPIRED",
    );
    need(
      scope.source === fresh.source &&
        command.source === fresh.source &&
        scope.publication === command.publication &&
        scope.command === hashJSON(command) &&
        scope.action === command.action &&
        command.manifest === fresh.hash,
      "QUALIFICATION_BINDING_DRIFT",
    );
    await validateCustody(command);
    need(
      !scope.consume || command.expiresAt > now(),
      "QUALIFICATION_APPROVAL_EXPIRED",
    );
    const initial = {
      source: fresh.source,
      manifestHash: fresh.hash,
      approvalHash: scope.command,
      backupReceiptHash: command.custody,
      planHash: scope.publication,
      hold: true,
    };
    if (scope.consume) {
      const journal = await control.openJournal(
        control.root + "/qualifications",
        command.id,
        initial,
        { expiresAt: command.expiresAt, now },
      );
      try {
        need(command.expiresAt > now(), "QUALIFICATION_APPROVAL_EXPIRED");
        await journal.append("committed_hold", { hold: true });
        need(command.expiresAt > now(), "QUALIFICATION_APPROVAL_EXPIRED");
      } finally {
        await journal.close();
      }
    } else {
      const journal = await control.readJournal(
        control.root + "/qualifications/" + command.id + ".jsonl",
      );
      need(!journal.requiresReconciliation, "QUALIFICATION_JOURNAL_TORN");
      const {
        sequence: _sequence,
        previous: _previous,
        state: _state,
        at: _at,
        hash: _hash,
        ...actual
      } = journal.records[0];
      need(
        hashJSON(actual) === hashJSON(initial) &&
          journal.last.state === "committed_hold",
        "QUALIFICATION_CUSTODY_DRIFT",
      );
    }
    return { ...fresh, manifest: fresh.hash, custody: command.custody };
  };
}
