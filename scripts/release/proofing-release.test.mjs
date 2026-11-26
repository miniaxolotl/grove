import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { route,routeHeldOperator } from "./proofing-release.mjs";
import * as releaseRoutes from './proofing-release.mjs';
import { updateImageSpec, findDeployment } from "../deploy-digitalocean.mjs";
const base = "6566c2dca78e7fde9c79357f8d07c5ad6f4cc7d5",
  merged = "a".repeat(40),
  stamp = "b".repeat(40);
const pr = {
  number: 293,
  base: { ref: "development" },
  merged: true,
  merge_commit_sha: merged,
};
const manifest = JSON.parse(readFileSync("release-please-config.json"));
function fixture(extra = "", edit = () => {},before='1.11.27',after='1.11.28',baseline=base) {
  return {
    git: (cmd, ...args) =>
      cmd === "diff"
        ? `CHANGELOG.md\npackage.json${extra}`
        : args[0] === `${merged}^1`
          ? baseline
          : merged,
    read: (ref, path) => {
      const ver = ref === merged ? before : after;
      const value =
        path === "release-please-config.json"
          ? globalThis.structuredClone(manifest)
          : path === ".release-please-manifest.json"
            ? { ".": ver }
            : path.endsWith("marketplace.json")
              ? { plugins: [{ source: { version: ver } }] }
              : { version: ver };
      if (ref === stamp) edit(path, value);
      return value;
    },
  };
}
test('operational recovery has one exact reviewed coordinated patch admission, not a website-only exemption',()=>{
  const operatorPr={...pr,number:337,head:{ref:'fix/release-operational-held-workflow',repo:{full_name:'miniaxolotl/grove'}}};
  const io=fixture('',()=>{},'1.11.34','1.11.35','978f9bc2f80ea9879afd132614d77afef1171690');
  assert.equal(routeHeldOperator(merged,operatorPr,false,io),'coordinated');assert.equal(routeHeldOperator(stamp,operatorPr,true,io),'coordinated');
  for(const change of [{number:338},{merged:false},{head:{ref:'another-branch'}},{base:{ref:'production'}}])assert.equal(routeHeldOperator(merged,{...operatorPr,...change},false,io),'website-only');
  assert.throws(()=>routeHeldOperator(stamp,operatorPr,true,fixture('\npackages/api/src/server.ts',()=>{},'1.11.34','1.11.35','978f9bc2f80ea9879afd132614d77afef1171690')));
});
test('action-pin repair has one exact coordinated 1.11.36 admission',()=>{
  assert.equal(typeof releaseRoutes.routeHeldActionPin,'function');
  const pinPr={...pr,number:340,head:{ref:'fix/release-held-action-pin',repo:{full_name:'miniaxolotl/grove'}}};
  const io=fixture('',()=>{},'1.11.35','1.11.36','0ec31adf20c68bc909a59d05cbb4e6e07681d3b6');
  assert.equal(releaseRoutes.routeHeldActionPin(merged,pinPr,false,io),'coordinated');
  assert.equal(releaseRoutes.routeHeldActionPin(stamp,pinPr,true,io),'coordinated');
  for(const change of [{number:341},{merged:false},{head:{ref:'another-branch'}},{base:{ref:'production'}}])assert.equal(releaseRoutes.routeHeldActionPin(merged,{...pinPr,...change},false,io),'website-only');
  assert.throws(()=>releaseRoutes.routeHeldActionPin(stamp,pinPr,true,fixture('\npackages/api/src/server.ts',()=>{},'1.11.35','1.11.36','0ec31adf20c68bc909a59d05cbb4e6e07681d3b6')));
});
test('current-proof recorder repair has one exact coordinated 1.11.37 admission',()=>{
  assert.equal(typeof releaseRoutes.routeHeldObservation,'function');
  const proofPr={...pr,number:343,head:{ref:'fix/release-current-runtime-proof',repo:{full_name:'miniaxolotl/grove'}}};
  const io=fixture('',()=>{},'1.11.36','1.11.37','a55f9e89df2131fdc993fc41bdbe648c8ec8e9d2');
  assert.equal(releaseRoutes.routeHeldObservation(merged,proofPr,false,io),'coordinated');
  assert.equal(releaseRoutes.routeHeldObservation(stamp,proofPr,true,io),'coordinated');
  for(const change of [{number:344},{merged:false},{head:{ref:'foreign'}},{base:{ref:'production'}}])assert.equal(releaseRoutes.routeHeldObservation(merged,{...proofPr,...change},false,io),'website-only');
  assert.throws(()=>releaseRoutes.routeHeldObservation(stamp,proofPr,true,fixture('\npackages/api/src/server.ts',()=>{},'1.11.36','1.11.37','a55f9e89df2131fdc993fc41bdbe648c8ec8e9d2')));
});
test("only the actual proofing merge can request the coordinated source release", () => {
  assert.equal(route(merged, pr, false, fixture()), "coordinated");
  for (const p of [
    { ...pr, merged: false },
    { ...pr, number: 286 },
    { ...pr, base: { ref: "production" } },
  ])
    assert.equal(route(merged, p, false, fixture()), "website-only");
  assert.equal(route(merged, pr, true, fixture()), "website-only");
});
test("release stamp must be an otherwise unmodified direct successor with all installer versions updated", () => {
  assert.equal(route(stamp, pr, true, fixture()), "coordinated");
  assert.throws(
    () => route(stamp, pr, true, fixture("\npackages/api/src/server.ts")),
    /Unreviewed/,
  );
  assert.throws(
    () =>
      route(
        stamp,
        pr,
        true,
        fixture("", (path, obj) => {
          if (path === "packages/api/package.json") obj.version = "1.11.24";
        }),
      ),
    /Unexpected/,
  );
  assert.throws(
    () =>
      route(
        stamp,
        pr,
        true,
        fixture("", (path, obj) => {
          if (path === "package.json") obj.scripts = { build: "changed" };
        }),
      ),
    /Unexpected/,
  );
});
test("coordinated topology uses two immutable images, one internal checker and no automatic text transmission", () => {
  const spec = JSON.parse(readFileSync(".do/app.json"));
  const main = "sha256:" + "a".repeat(64),
    checker = "sha256:" + "b".repeat(64);
  const next = updateImageSpec(spec, main, checker, true);
  const lt = next.services.find((s) => s.name === "languagetool");
  assert.deepEqual(lt.internal_ports, [8081]);
  assert.equal(lt.image.repository, "grove");
  assert.equal(lt.image.digest, checker);
  assert.equal(lt.instance_count, 1);
  assert.equal(lt.instance_size_slug, "apps-s-1vcpu-1gb-fixed");
  assert.equal(lt.http_port, undefined);
  assert.deepEqual(next.ingress, spec.ingress);
  assert(!JSON.stringify(next).includes("LANGUAGETOOL_URL"));
  assert.equal(
    findDeployment([{ id: "all", spec: next }], main, [], checker)?.id,
    "all",
  );
  assert.throws(() => updateImageSpec(spec, main, main, true));
});
