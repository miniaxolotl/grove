// Local operator entry point. With the retained frozen operator it can only
// report the hard block. No flag or parent approval can override qualification.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";
import { receiptHash } from "./held-state.mjs";
import { resolveHeldDecision } from "./held-delivery.mjs";
import { loadPublication, loadReceipt } from "./held-artifacts.mjs";
import {
  prepareHeld,
  prepareReconcile,
  prepareLifecycleIngress,
  prepareApproved,
  preparePublic,
  verifyLifecycle,
  verifyRuntime,
} from "./held-provider.mjs";
import { probeConsole } from "./held-console.mjs";
import {
  runProviderTransition,
  reconcileProviderTransition,
  runDatabaseTransition,
  validateOperatorCommand,
  validateBackupCustody,
} from "./held-operator.mjs";
import {
  applyLifecycleTransition,
  verifyLifecycleTransition,
} from "./held-lifecycle.mjs";
import {
  appStateFingerprint,
  readProviderResponse,
} from "../deploy-digitalocean.mjs";
import { readGitHubJson } from "../ci/github-json.mjs";
import { qualifyIndependent } from "./held-operator-qualification.mjs";
import { deploymentSpecMatches, providerInstanceInventory } from "./held-provider-response.mjs";
import { createProviderDispatch } from "./held-operator-provider-io.mjs";
import {
  verifyOperatorRoot,
  readTrustedPin,
} from "./held-operator-bootstrap.mjs";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const phaseFor = {
  restore: "published_held",
  admit: "held_verified",
  reconcile: "held_verified",
  "lifecycle-ingress": "held_verified",
  handoff: "lifecycle_verified",
  effects: "effects_approved",
  "open-public": "runtime_verified",
  "public-health": "runtime_verified",
};
let db;
try {
  const [verb, ...args] = process.argv.slice(2);
  if (!verb) {
    process.stdout.write(
      "Usage: node scripts/release/held-operator-cli.mjs plan|execute|reconcile|resolve|resolve-idle --operator-root <qualified independent directory> --request <private scoped JSON>\n",
    );
  } else {
    assert(
      ["plan", "execute", "reconcile", "resolve", "resolve-idle"].includes(
        verb,
      ),
    );
    assert.equal(args.length, 4);
    assert.equal(args[0], "--operator-root");
    assert.equal(args[2], "--request");
    const root = pathToFileURL(
      (await verifyOperatorRoot(resolve(args[1]), await readTrustedPin())) +
        "/",
    );
    const control = await import(new URL("operator-control.mjs", root).href),
      plans = await import(new URL("operator-plan.mjs", root).href);
    const manifest = await plans.operatorManifest({
      readOnly: verb !== "execute",
    });
    if (!manifest.executionAdmitted || manifest.hardBlock) {
      process.stdout.write(
        JSON.stringify({
          executionAdmitted: false,
          source: manifest.source,
          manifest: manifest.hash,
          code: manifest.hardBlock ?? "OPERATOR_NOT_QUALIFIED",
        }) + "\n",
      );
      process.exitCode = 2;
    } else {
      assert.equal(manifest.contract, "source-bound-held-release-v1");
      const request = await control.readPrivate(args[3]),
        command = request.command;
      assert.equal(command.manifest, manifest.hash);
      assert.equal(command.source, manifest.source);
      assert.equal(git("rev-parse", "HEAD"), manifest.source);
      const selected = resolveHeldDecision(manifest.source, true);
      assert(selected);
      const branch = readGitHubJson(
        "repos/miniaxolotl/grove/branches/production",
      );
      assert.equal(branch.protected, true);
      const user = readGitHubJson("user");
      assert.equal(user.login, "miniaxolotl");
      const current = () =>
        assert.equal(
          readGitHubJson("repos/miniaxolotl/grove/git/ref/heads/production")
            .object.sha,
          branch.commit.sha,
        );
      const context = {
        repository: "miniaxolotl/grove",
        actor: user.login,
        protected: true,
        source: manifest.source,
        production: branch.commit.sha,
        tree: git("rev-parse", "HEAD^{tree}"),
        tag: `v${JSON.parse(git("show", "HEAD:package.json")).version}`,
        apiVersion: JSON.parse(git("show", "HEAD:packages/api/package.json"))
          .version,
        run: request.publication.run,
        attempt: request.publication.attempt,
        heldDecision: selected.manifest,
      };
      const p = await loadPublication(
        request.publication.run,
        request.publication.attempt,
        context,
      );
      const parent =
        command.action === "restore"
          ? p
          : await loadReceipt(
              {
                run: request.previous.run,
                attempt: request.previous.attempt,
                phase: phaseFor[command.action],
                publication: p,
              },
              context,
            );
      validateOperatorCommand(
        p,
        parent,
        command,
        Date.now(),
        verb !== "execute" && verb !== "plan",
      );
      current();
      const backupReceipt = await control.readPrivate(request.backupReceipt);
      const backupJournal = await control.readJournal(request.backupJournal);
      const ciphertext = await control.readPrivate(request.backupCiphertext, {
        json: false,
        max: 256 * 1024 * 1024,
      });
      validateBackupCustody(command, backupReceipt, backupJournal, ciphertext);
      const external = await import(new URL("operator-io.mjs", root).href);
      const token = await external.secret("DIGITALOCEAN_ACCESS_TOKEN", {
          readOnly: verb !== "execute",
        }),
        appId = await external.secret("DIGITALOCEAN_APP_ID", {
          readOnly: verb !== "execute",
        });
      assert.equal(appId, p.evidence.baseline.app);
      const remote = async (path, body) => {
        const response = await globalThis.fetch(
          `https://api.digitalocean.com${path}`,
          {
            method: body ? "PUT" : "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              ...(body ? { "Content-Type": "application/json" } : {}),
            },
            ...(body
              ? {
                  body: JSON.stringify({
                    spec: body,
                    update_all_source_versions: false,
                  }),
                }
              : {}),
            redirect: "error",
            signal: globalThis.AbortSignal.timeout(30000),
          },
        );
        return readProviderResponse(response, body ? "PUT" : "GET", path);
      };
      const getApp = async () => (await remote(`/v2/apps/${appId}`)).app;
      const getInstances = async () => {
        const app = await getApp();
        const page = await remote(`/v2/apps/${appId}/instances`);
        return providerInstanceInventory(page, app);
      };
      const observe = async () => {
        const app = await getApp();
        assert.equal(app.id, appId);
        assert(!app.pending_deployment && !app.in_progress_deployment);
        assert.equal(app.active_deployment?.phase, "ACTIVE");
        assert(deploymentSpecMatches(app), "DEPLOYMENT_SPEC_DRIFT");
        const instances = await getInstances();
        assert.equal(
          appStateFingerprint(await getApp()),
          appStateFingerprint(app),
        );
        return {
          app,
          instances,
          state: appStateFingerprint(app),
          settings: appStateFingerprint({ id: appId, spec: app.spec }),
          generation: app.active_deployment.id,
        };
      };
      if (
        command.action === "restore" &&
        ["execute", "plan"].includes(verb) &&
        (await observe()).settings !== command.proposed
      ) {
        const hosted = await import(new URL("operator-hosted.mjs", root).href);
        const backup = await import(new URL("operator-backup.mjs", root).href);
        const held = await hosted.observeHosted({ token });
        assert.equal(held.fingerprint, backupReceipt.heldSpecHash);
        assert.equal(held.deploymentId, backupReceipt.heldDeploymentId);
        assert(
          held.archive &&
            held.maintenance &&
            held.settled &&
            held.instances.length === 0 &&
            !held.inProgress,
        );
        const lifecycle = await control.readPrivate(request.lifecycleCustody),
          remote = await control.readPrivate(request.remoteCustody);
        await backup.validateCustody({
          lifecycle,
          remote,
          held,
          heldAt: request.heldAt,
          now: Date.now(),
        });
      }
      const proofIO = {
        getApp,
        getInstances,
        probe: (scope) => probeConsole(scope),
      };
      let providerSubmitted = false;
      const io = {
        qualify: (scope) =>
          qualifyIndependent(
            {
              current,
              plans,
              manifest,
              command,
              external,
              validateCustody: async () =>
                validateBackupCustody(
                  command,
                  await control.readPrivate(request.backupReceipt),
                  await control.readJournal(request.backupJournal),
                  await control.readPrivate(request.backupCiphertext, {
                    json: false,
                    max: 256 * 1024 * 1024,
                  }),
                ),
            },
            scope,
          ),
        journal: (id, initial) =>
          control.openJournal(request.journalDirectory, id, initial),
        readJournal: (id) =>
          control.readJournal(`${request.journalDirectory}/${id}.jsonl`),
        getState: observe,
        verify: async () => {
          const state = await observe();
          if (verb === "execute" && providerSubmitted)
            await external.finishProviderWrite(command, state, {
              digest: p.release.digest,
            });
          else if (verb === "reconcile")
            await external.readbackProviderWrite(command, state, {
              digest: p.release.digest,
            });
          return state;
        },
        specFingerprint: (spec) => appStateFingerprint({ id: appId, spec }),
        put: createProviderDispatch({
          observe,
          current,
          external,
          command,
          digest: p.release.digest,
          validate: () =>
            validateOperatorCommand(p, parent, command, Date.now()),
          submit: async (spec) => {
            providerSubmitted = true;
            await remote(`/v2/apps/${appId}`, spec);
          },
        }),
        assertExclusiveWindow: (approved, state) =>
          external.assertExclusiveWindow(approved, state, {
            digest: p.release.digest,
          }),
      };
      if (verb === "resolve-idle") {
        await io.qualify({
          source: manifest.source,
          publication: receiptHash(p),
          command: receiptHash(command),
          action: command.action,
          consume: false,
        });
        await external.resolveIdleWrite(command, await observe(), {
          digest: p.release.digest,
        });
        process.stdout.write(
          JSON.stringify({
            authorityOnly: true,
            resolved: true,
            reopen: false,
          }) + "\n",
        );
      } else if (["admit", "handoff", "open-public"].includes(command.action)) {
        const { createDatabase } = await external.databaseLibrary({
          readOnly: verb !== "execute",
        });
        const sql = await import(new URL("window-db.mjs", root).href);
        const url = await external.secret("MIGRATION_DATABASE_URL", {
          readOnly: verb !== "execute",
        });
        sql.assertOwnerTarget(url);
        db = createDatabase(url, {
          ssl: true,
          max: 1,
          acquireTimeoutMs: 10000,
          statementTimeoutMs: 10000,
        });
        await sql.verifyOwnerDatabase(db);
        io.prepareDatabaseWrite = (...values) =>
          external.prepareDatabaseWrite(...values);
        io.finishDatabaseWrite = (...values) =>
          external.finishDatabaseWrite(...values);
        io.applyDatabase = (...values) =>
          applyLifecycleTransition(db, sql.boundedTransaction, ...values);
        io.verifyDatabase = (...values) =>
          verifyLifecycleTransition(db, ...values);
        if (verb === "plan")
          process.stdout.write(
            JSON.stringify({
              action: command.action,
              command: receiptHash(command),
              source: manifest.source,
              execution: false,
            }) + "\n",
          );
        else if (verb === "reconcile" || verb === "resolve") {
          await io.qualify({
            source: manifest.source,
            publication: receiptHash(p),
            command: receiptHash(command),
            action: command.action,
            consume: false,
          });
          const journal = await io.readJournal(command.id);
          assert(
            !journal.requiresReconciliation &&
              journal.records[0]?.approvalHash === receiptHash(command),
          );
          const proof = await verifyLifecycleTransition(db, p, parent, command);
          await external.readbackDatabaseWrite(command, await observe(), proof);
          if (verb === "resolve")
            await external.resolveDatabaseWrite(
              command,
              await observe(),
              proof,
            );
          process.stdout.write(
            JSON.stringify({
              action: command.action,
              verified: true,
              readOnly: verb === "reconcile",
              authorityOnly: verb === "resolve",
            }) + "\n",
          );
        } else {
          await runDatabaseTransition(p, parent, command, io);
          process.stdout.write(
            JSON.stringify({
              action: command.action,
              verified: true,
              hold: true,
            }) + "\n",
          );
        }
      } else {
        if (verb === "reconcile" || verb === "resolve") {
          await reconcileProviderTransition(p, parent, command, io);
          if (verb === "resolve")
            await external.resolveProviderWrite(command, await observe(), {
              digest: p.release.digest,
            });
        } else {
          const before = await observe();
          let spec;
          const params = [before.app, before.instances, p, parent];
          if (before.settings === command.proposed) spec = before.app.spec;
          else if (command.action === "restore")
            spec = prepareHeld(...params.slice(0, 3));
          else if (command.action === "reconcile")
            spec = prepareReconcile(...params);
          else if (command.action === "lifecycle-ingress")
            spec = prepareLifecycleIngress(
              ...params,
              await verifyLifecycle(p, parent, proofIO),
            );
          else if (command.action === "effects")
            spec = prepareApproved(...params);
          else {
            assert.equal(command.action, "public-health");
            assert(request.publicCommand);
            const hash = validateOperatorCommand(
              p,
              parent,
              request.publicCommand,
            );
            spec = preparePublic(
              before.app,
              before.instances,
              p,
              parent.parent,
              await verifyRuntime(p, parent.parent, proofIO, Date.now(), hash),
              hash,
            );
          }
          assert.equal(io.specFingerprint(spec), command.proposed);
          if (verb === "execute")
            await runProviderTransition(p, parent, command, spec, io);
          else
            process.stdout.write(
              JSON.stringify({
                action: command.action,
                expected: before.state,
                proposed: io.specFingerprint(spec),
                execution: false,
              }) + "\n",
            );
        }
      }
    }
  }
} catch {
  process.stderr.write(
    "Held operator remains held/unqualified. Inspect private journal and independent source/backup/custody qualification; no automatic retry or reopen.\n",
  );
  process.exitCode = 1;
} finally {
  await db?.destroy();
}
