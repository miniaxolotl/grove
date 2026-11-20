// Installation policy and review key are independently installed private files.
// Import is inert. No default source, production admission or secret fallback.
import { installedControl, need, sha } from "./operator-control.mjs";
import { qualifyInstallation, createQualifier } from "./qualification.mjs";
import { createIO } from "./operator-io.mjs";
import { createRestorer } from "./operator-restore.mjs";
import { createBackup } from "./operator-backup.mjs";
import { createHosted } from "./operator-hosted.mjs";
import { createMigrationOperator } from "./window-policy.mjs";
import { validateBackupCustody } from "../../scripts/release/held-operator.mjs";
import {
  readTrustedPin,
  assertImmutableCode,
  verifyOperatorRoot,
} from "../../scripts/release/held-operator-bootstrap.mjs";
import { operatorRoot } from "./qualification.mjs";
import { openAuthority } from "./authority.mjs";
import { createProviderWindow } from "./window.mjs";
import { randomUUID } from "node:crypto";
const controllerOwner = randomUUID();
export async function readPinnedReviewKey(control, trusted) {
  const key = (
    await control.readPrivate(control.root + "/review-key.pem", { json: false })
  ).toString();
  need(
    trusted.reviewKeySha256 && sha(key) === trusted.reviewKeySha256,
    "INDEPENDENT_REVIEW_AUTHORITY_NOT_INSTALLED",
  );
  return key;
}
export async function loadInstallation({ readOnly = false } = {}) {
  const trusted = await readTrustedPin();
  await verifyOperatorRoot(operatorRoot, trusted);
  const control = await installedControl(),
    config = await control.readPrivate(control.root + "/installation.json");
  const publicKey = await readPinnedReviewKey(control, trusted);
  await assertImmutableCode(config.sourceRoot);
  const checked = await qualifyInstallation({
    control,
    config,
    publicKey,
    readOnly,
  });
  const manifest = async () =>
    (
      await qualifyInstallation({
        control,
        config: await control.readPrivate(control.root + "/installation.json"),
        publicKey: await readPinnedReviewKey(control, trusted),
        readOnly,
      })
    ).manifest;
  need(
    config.policy?.parentSession &&
      config.policy.appId === "3aef47f9-3724-4f21-9cad-8c4eb5644af0",
    "INSTALLATION_POLICY_REQUIRED",
  );
  const io = createIO({ control, sourceRoot: config.sourceRoot, manifest });
  const authority = openAuthority(config.authority),
    window = createProviderWindow({
      control,
      authority,
      manifest: checked.manifest,
      policy: config.policy,
      config: config.window,
      publicKey,
      owner: controllerOwner,
    });
  const database = await import(
    "file://" + config.sourceRoot + "/lib/database/src/index.ts"
  );
  const restorer = createRestorer({
    control,
    sourceRoot: config.sourceRoot,
    crypt: io.crypt,
  });
  const backup = createBackup({
    control,
    source: checked.source,
    manifest,
    ...config.policy,
    crypt: io.crypt,
    restoreEncryptedBackup: restorer.restoreEncryptedBackup,
    assertWindow: (approval, held) =>
      window.assert(approval, held.providerState),
    releaseWindow: (approval, held) =>
      window.release(approval, held.providerState),
  });
  const observeHosted = createHosted(config.policy);
  const validateCustody = async (command) => {
    const live = config.live;
    need(live, "LIVE_CUSTODY_REQUIRED");
    const receipt = await control.readPrivate(live.receipt),
      journal = await control.readJournal(live.journal),
      ciphertext = await control.readPrivate(live.ciphertext, {
        json: false,
        max: 256 * 1024 * 1024,
      });
    const originals = await control.readPrivate(live.originals, {
      json: false,
      max: 256 * 1024 * 1024,
    });
    need(
      sha(originals) === config.policy.originalsEncryptedSha256 &&
        receipt.originalsHash === config.policy.originalsEncryptedSha256 &&
        receipt.reviewDue === config.policy.originalsReviewDue,
      "ORIGINAL_CUSTODY_POLICY_DRIFT",
    );
    validateBackupCustody(command, receipt, journal, ciphertext);
    return receipt;
  };
  const qualify = createQualifier({ control, manifest, validateCustody });
  const migration = createMigrationOperator({
    control,
    source: checked.source,
    blueprint: checked.blueprint,
    manifest,
    validateCustody,
    assertWindow: (approval, held) =>
      window.assert(approval, held.providerState),
    verifyWindow: (options) => window.verify(options),
    prepareWindow: async (approval, proofHash) => {
      const held = await observeHosted({
        token: await io.secret("DIGITALOCEAN_ACCESS_TOKEN"),
      });
      await window.assert(approval, held.providerState);
      return window.prepare(approval, held.providerState, {
        kind: "migration",
        proofHash,
      });
    },
    finishWindow: async (approval, proofHash) =>
      window.finish(
        approval,
        (
          await observeHosted({
            token: await io.secret("DIGITALOCEAN_ACCESS_TOKEN"),
          })
        ).providerState,
        { kind: "migration", proofHash },
      ),
    resolveWindow: async (approval, proofHash) =>
      window.resolveMigration(
        approval,
        (
          await observeHosted({
            token: await io.secret("DIGITALOCEAN_ACCESS_TOKEN"),
          })
        ).providerState,
        { kind: "migration", proofHash },
      ),
    observe: async () =>
      observeHosted({ token: await io.secret("DIGITALOCEAN_ACCESS_TOKEN") }),
    validateHoldCustody: async (held) =>
      backup.validateCustody({
        held,
        lifecycle: await control.readPrivate(config.live.lifecycle),
        remote: await control.readPrivate(config.live.remote),
        heldAt: config.live.heldAt,
        now: Date.now(),
      }),
    verify: async () => {
      const fresh = await manifest();
      need(
        fresh.executionAdmitted && fresh.hash === checked.manifest.hash,
        "OPERATOR_NOT_QUALIFIED",
      );
    },
  });
  return {
    control,
    manifest,
    source: checked.source,
    blueprint: checked.blueprint,
    io,
    restorer,
    backup,
    observeHosted,
    qualify,
    validateCustody,
    migration,
    window,
    database,
  };
}
