// Parent-only operator command. No imports start jobs, load credentials or write.
import assert from "node:assert/strict";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { loadInstallation } from "./installation.mjs";
import { observePlan } from "./operator-plan.mjs";
import { assertOwnerTarget } from "./window-db.mjs";
import { verifyClient } from "./operator-io.mjs";
let db;
try {
  const [verb, ...args] = process.argv.slice(2);
  if (!verb)
    process.stdout.write(
      "Usage: node ops/held-operator/migration-cli.mjs plan --out <new private JSON> | execute|reconcile|resolve --request <private JSON>\n",
    );
  else {
    assert(["plan", "execute", "reconcile", "resolve"].includes(verb));
    assert.equal(args.length, 2);
    assert.equal(args[0], verb === "plan" ? "--out" : "--request");
    const install = await loadInstallation({ readOnly: verb === "reconcile" }),
      manifest = await install.manifest();
    assert(manifest.executionAdmitted && !manifest.hardBlock);
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      manifest.source,
    );
    const url = await install.io.secret("MIGRATION_DATABASE_URL");
    assertOwnerTarget(url);
    if (verb === "plan") {
      const token = await install.io.secret("DIGITALOCEAN_ACCESS_TOKEN");
      const plan = await observePlan({
        source: install.source,
        manifest,
        observe: () => install.observeHosted({ token }),
        target: {
          connect: () => install.io.readClient(url),
          verify: verifyClient,
        },
      });
      await install.control.durableWrite(
        args[1],
        JSON.stringify(plan, null, 2) + "\n",
      );
      process.stdout.write(
        JSON.stringify({
          source: manifest.source,
          execution: false,
          history: plan.before.metadata.history.length,
        }) + "\n",
      );
    } else {
      const request = await install.control.readPrivate(args[1]);
      db = install.database.createDatabase(url, {
        ssl: true,
        max: 1,
        acquireTimeoutMs: 10000,
        statementTimeoutMs: 10000,
      });
      const result = await install.migration[verb]({
        db,
        plan: request.plan,
        approval: request.approval,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
    }
  }
} catch {
  process.stderr.write(
    "Migration operator remains held/unqualified. Inspect private evidence and journals; unknown acceptance permits readback only, never automatic retry or reopen.\n",
  );
  process.exitCode = 1;
} finally {
  await db?.destroy();
}
