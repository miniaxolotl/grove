import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("four runnable components publish independently to both registries", async () => {
  assert(existsSync("scripts/release/container-images.mjs"));
  const { imagePlan } = await import("./container-images.mjs");
  const plan = imagePlan("a".repeat(40), "v1.11.38");
  assert.deepEqual(
    plan.map((image) => image.component),
    ["api", "mcp", "website", "languagetool"],
  );
  for (const image of plan) {
    for (const host of ["ghcr.io/", ""]) {
      const repository = `${host}miniaxolotl/grove-${image.component}`;
      assert(image.sourceRefs.includes(`${repository}:sha-${"a".repeat(40)}`));
      assert(image.releaseRefs.includes(`${repository}:v1.11.38`));
      assert(image.latestRefs.includes(`${repository}:latest`));
    }
  }
  assert(
    plan[0].sourceRefs.includes(`miniaxolotl/grove:sha-${"a".repeat(40)}`),
  );
  assert(
    plan[3].sourceRefs.includes(
      `miniaxolotl/grove:languagetool-sha-${"a".repeat(40)}`,
    ),
  );
  assert.throws(() => imagePlan("moving", "v1.11.38"));
  assert.throws(() => imagePlan("a".repeat(40), "latest"));
});

function fixture(plan) {
  const refs = new Map(),
    writes = [],
    builds = [],
    verified = [];
  let current = true;
  const io = {
    current() {
      assert(current, "superseded");
    },
    inspect(ref) {
      return refs.get(ref) ?? null;
    },
    build(image) {
      builds.push(image.component);
      const digest = `sha256:${String(plan.indexOf(image) + 1).repeat(64)}`;
      refs.set(image.sourceRefs[0], digest);
      return digest;
    },
    verify(image, reference, digest) {
      verified.push({ component: image.component, reference, digest });
    },
    mirror(source, target, digest) {
      writes.push(target);
      refs.set(target, digest);
    },
  };
  return {
    io,
    refs,
    writes,
    builds,
    verified,
    supersede() {
      current = false;
    },
  };
}

test("publication verifies all immutable destinations before writes and resumes partial mirrors", async () => {
  assert(existsSync("scripts/release/container-images.mjs"));
  const { imagePlan, prepareImages, promoteImages } =
    await import("./container-images.mjs");
  const plan = imagePlan("a".repeat(40), "v1.11.38");
  const f = fixture(plan);
  const manifest = prepareImages(plan, f.io);
  assert.equal(f.builds.length, 4);
  assert.equal(f.verified.length, 4);
  assert(
    f.writes.every(
      (ref) => !ref.endsWith(":latest") && !ref.endsWith(":v1.11.38"),
    ),
  );
  promoteImages(plan, manifest, f.io);
  for (const image of plan)
    for (const ref of [
      ...image.sourceRefs,
      ...image.releaseRefs,
      ...image.latestRefs,
    ])
      assert.equal(f.refs.get(ref), manifest.images[image.component].digest);
  f.refs.delete(plan[2].sourceRefs[1]);
  prepareImages(plan, f.io);
  assert.equal(
    f.builds.length,
    4,
    "Retry must reuse verified immutable images, not rebuild",
  );
  assert(f.refs.has(plan[2].sourceRefs[1]));
});

test("conflicts, unavailable registries, stale source and changed manifests fail closed", async () => {
  assert(existsSync("scripts/release/container-images.mjs"));
  const { imagePlan, prepareImages, promoteImages } =
    await import("./container-images.mjs");
  const plan = imagePlan("a".repeat(40), "v1.11.38");
  for (const broken of ["conflict", "registry", "stale"]) {
    const f = fixture(plan);
    if (broken === "conflict") {
      f.refs.set(plan[3].sourceRefs[0], `sha256:${"b".repeat(64)}`);
      f.refs.set(plan[3].releaseRefs[1], `sha256:${"c".repeat(64)}`);
    }
    if (broken === "registry")
      f.io.inspect = () => {
        throw Error("registry unavailable");
      };
    if (broken === "stale") f.supersede();
    assert.throws(() => prepareImages(plan, f.io));
    assert.equal(f.writes.length, 0);
    assert.equal(f.builds.length, 0);
  }
  const f = fixture(plan),
    manifest = prepareImages(plan, f.io);
  const writes = f.writes.length;
  manifest.source = "b".repeat(40);
  assert.throws(() => promoteImages(plan, manifest, f.io));
  assert.equal(f.writes.length, writes);
});

test("MCP and website targets keep runtime-only non-root images and API compatibility", () => {
  const docker = readFileSync("Dockerfile", "utf8");
  assert.match(docker, /AS mcp\n/);
  assert.match(docker, /CMD \["mcp", "--stdio"\]/);
  assert.match(docker, /AS website\n/);
  assert.match(docker, /\.next\/standalone/);
  assert.match(docker, /\.next\/static/);
  assert.match(docker, /public \/app\/packages\/website\/public/);
  assert.match(docker, /FROM api AS production/);
  assert.match(readFileSync(".dockerignore", "utf8"), /^\*\*\/\.vercel$/m);
  assert(
    existsSync("scripts/testing/container-images.mjs"),
    "All runtimes require actual image smoke checks",
  );
  assert.match(
    readFileSync(".github/workflows/ci.yml", "utf8"),
    /bash scripts\/testing\/verify-images\.sh/,
  );
});

test("an existing image with invalid provenance stops all new publication", async () => {
  const { imagePlan, prepareImages } = await import("./container-images.mjs");
  const plan = imagePlan("a".repeat(40), "v1.11.38");
  const f = fixture(plan);
  f.refs.set(plan[3].sourceRefs[0], `sha256:${"d".repeat(64)}`);
  f.io.verify = (image) => {
    if (image.component === "languagetool") throw Error("wrong source label");
  };
  assert.throws(() => prepareImages(plan, f.io), /wrong source label/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.builds.length, 0);
});
