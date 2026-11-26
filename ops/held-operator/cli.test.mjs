import assert from "node:assert/strict";
import test from "node:test";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
test("migration entrypoint defaults to help, and unconfigured execution fails before credential access", () => {
  const help = spawnSync(
    process.execPath,
    ["ops/held-operator/migration-cli.mjs"],
    { encoding: "utf8" },
  );
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);
  const env = { ...process.env };
  delete env.GROVE_OPERATOR_CUSTODY_ROOT;
  const execute = spawnSync(
    process.execPath,
    [
      "ops/held-operator/migration-cli.mjs",
      "execute",
      "--request",
      "/never-read",
    ],
    { encoding: "utf8", env },
  );
  assert.equal(execute.status, 1);
  assert.match(execute.stderr, /unqualified/);
  assert.doesNotMatch(
    execute.stderr,
    /doppler|password|DATABASE_URL|\/never-read/,
  );
});

test("migration execution uses the qualified database module after mutable configuration replacement", async () => {
  const root = await mkdtemp(process.cwd() + "/.migration-cli-race-");
  try {
    const replacement = root + "/replacement";
    const marker = root + "/replacement-imported";
    await mkdir(replacement + "/lib/database/src", { recursive: true });
    await writeFile(
      replacement + "/lib/database/src/index.ts",
      `import {writeFileSync} from "node:fs";writeFileSync(${JSON.stringify(marker)}, "unqualified module imported");export const createDatabase=()=>({destroy:async()=>{}});`,
    );
    const script = `
      import assert from "node:assert/strict";
      import {mock} from "node:test";
      import {execFileSync} from "node:child_process";
      const events=[];
      let configuredSource="/synthetic/qualified-source";
      const source=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
      const db={destroy:async()=>events.push("destroy")};
      const manifest={source,executionAdmitted:true};
      const install={
        manifest:async()=>manifest,
        io:{secret:async()=>{
          configuredSource=${JSON.stringify(replacement)};
          return "postgresql://grove_owner:synthetic-not-a-secret@ep-mute-paper-b7a16e6n.c-13.us-east-1.aws.neon.tech:5432/grove?sslmode=verify-full";
        }},
        control:{root:"/synthetic",readPrivate:async(path)=>{
          if(path.endsWith("installation.json"))return {sourceRoot:configuredSource};
          return {plan:{synthetic:true},approval:{synthetic:true}};
        }},
        database:{createDatabase:()=>{events.push("qualified-database");return db;}},
        migration:{execute:async({db:received})=>{
          assert.equal(received,db,"migration must receive the qualified database");
          events.push("execute");return {synthetic:true};
        }},
      };
      mock.module(${JSON.stringify(pathToFileURL(process.cwd() + "/ops/held-operator/installation.mjs").href)}, {
        namedExports:{loadInstallation:async()=>install},
      });
      process.argv=[process.execPath,"migration-cli.mjs","execute","--request","/synthetic-request"];
      await import(${JSON.stringify(pathToFileURL(process.cwd() + "/ops/held-operator/migration-cli.mjs").href)});
      console.log(JSON.stringify(events));
    `;
    const result = spawnSync(
      process.execPath,
      ["--experimental-test-module-mocks", "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 15000 },
    );
    await assert.rejects(access(marker), { code: "ENOENT" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\["qualified-database","execute","destroy"\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
