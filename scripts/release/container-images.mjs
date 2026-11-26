import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";
import { assertCurrentRef, workflowContext } from "../ci/current-ref.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
export function imagePlan(source, tag) {
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  return ["api", "mcp", "website", "languagetool"].map((component) => {
    const repositories = ["ghcr.io/", ""].map(
      (host) => `${host}miniaxolotl/grove-${component}`,
    );
    if (component === "api")
      repositories.push("ghcr.io/miniaxolotl/grove", "miniaxolotl/grove");
    const sourceRefs = repositories.map((repo) => `${repo}:sha-${source}`);
    if (component === "languagetool")
      sourceRefs.push(`miniaxolotl/grove:languagetool-sha-${source}`);
    return {
      component,
      source,
      tag,
      context: component === "languagetool" ? "ops/languagetool" : ".",
      target: component === "languagetool" ? null : component,
      sourceRefs,
      releaseRefs: repositories.map((repo) => `${repo}:${tag}`),
      latestRefs: repositories.map((repo) => `${repo}:latest`),
    };
  });
}

export function preflightImages(plan, io) {
  io.current();
  return new Map(
    plan.map((image) => {
      const found = [...image.sourceRefs, ...image.releaseRefs]
        .map((ref) => ({ ref, digest: io.inspect(ref) }))
        .filter(({ digest }) => digest !== null);
      for (const { digest } of found) assert.match(digest, digestPattern);
      assert(
        new Set(found.map(({ digest }) => digest)).size <= 1,
        `Conflicting immutable ${image.component} images`,
      );
      return [image.component, found[0] ?? null];
    }),
  );
}

function mirror(io, source, target, digest) {
  const previous = io.inspect(target);
  if (previous === digest) return;
  assert(
    previous === null || target.endsWith(":latest"),
    "Immutable image changed before write",
  );
  io.current();
  io.mirror(source, target, digest);
  assert.equal(io.inspect(target), digest, "Registry mirror identity mismatch");
}

export function prepareImages(plan, io) {
  // Check every component/registry first. An outage or conflict cannot silently
  // turn a retry into a rebuild or overwrite an immutable tag.
  const existing = preflightImages(plan, io);
  const manifest = { source: plan[0].source, tag: plan[0].tag, images: {} };
  for (const image of plan) {
    const found = existing.get(image.component);
    if (found)
      io.verify(
        image,
        `${found.ref.split(":")[0]}@${found.digest}`,
        found.digest,
      );
  }
  for (const image of plan) {
    const found = existing.get(image.component);
    if (!found) io.current();
    const digest = found?.digest ?? io.build(image);
    assert.match(digest, digestPattern);
    const reference = `${(found?.ref ?? image.sourceRefs[0]).split(":")[0]}@${digest}`;
    if (!found) io.verify(image, reference, digest);
    for (const ref of image.sourceRefs) mirror(io, reference, ref, digest);
    manifest.images[image.component] = { digest, reference };
  }
  return manifest;
}

export function promoteImages(plan, manifest, io) {
  assert.equal(manifest.source, plan[0].source);
  assert.equal(manifest.tag, plan[0].tag);
  assert.deepEqual(
    Object.keys(manifest.images).sort(),
    plan.map((image) => image.component).sort(),
  );
  const existing = preflightImages(plan, io);
  for (const image of plan) {
    const { digest, reference } = manifest.images[image.component];
    assert.match(digest, digestPattern);
    assert.equal(existing.get(image.component)?.digest, digest);
    assert.equal(reference.split("@")[1], digest);
    assert(
      image.sourceRefs.some(
        (ref) => reference === `${ref.split(":")[0]}@${digest}`,
      ),
    );
  }
  for (const image of plan) {
    const { digest, reference } = manifest.images[image.component];
    for (const ref of [...image.releaseRefs, ...image.latestRefs])
      mirror(io, reference, ref, digest);
  }
}

function productionIo(env) {
  const run = (args, options = {}) =>
    execFileSync("docker", args, {
      encoding: "utf8",
      timeout: 30 * 60_000,
      ...options,
    });
  return {
    current: () => assertCurrentRef(workflowContext()),
    inspect(ref) {
      const result = spawnSync(
        "docker",
        [
          "buildx",
          "imagetools",
          "inspect",
          ref,
          "--format",
          "{{.Manifest.Digest}}",
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      if (result.status === 0) {
        const digest = result.stdout.trim();
        assert.match(digest, digestPattern);
        return digest;
      }
      if (
        result.status === 1 &&
        /manifest unknown|not found|no such manifest/i.test(result.stderr) &&
        !/unauthorized|denied|rate limit|too many requests/i.test(result.stderr)
      )
        return null;
      throw new Error(`Registry inspection failed for ${ref}`);
    },
    build(image) {
      const directory = mkdtempSync(join(tmpdir(), "grove-image-build-"));
      try {
        const metadata = join(directory, "metadata.json");
        const args = [
          "buildx",
          "build",
          "--platform",
          "linux/amd64",
          "--provenance=mode=max",
          "--sbom=true",
          "--push",
          "--tag",
          image.sourceRefs[0],
          "--metadata-file",
          metadata,
          "--label",
          `org.opencontainers.image.revision=${image.source}`,
          "--label",
          "org.opencontainers.image.source=https://github.com/miniaxolotl/grove",
          "--label",
          `org.opencontainers.image.title=grove-${image.component}`,
          "--label",
          `org.opencontainers.image.version=${image.tag.slice(1)}`,
        ];
        if (image.target) args.push("--target", image.target);
        for (const key of [
          "GROVE_TELEMETRY_BUILD",
          "RELEASE_SOURCE_SHA",
          "GROVE_POSTHOG_KEY",
          "GROVE_CLI_SENTRY_DSN",
          "GROVE_API_SENTRY_DSN",
        ])
          if (image.target && env[key])
            args.push("--build-arg", `${key}=${env[key]}`);
        if (image.component === "website") {
          const publicConfig = JSON.parse(
            readFileSync("website-image-env.json", "utf8"),
          );
          for (const [key, value] of Object.entries(publicConfig)) {
            assert(
              [
                "SITE_URL",
                "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
                "NEXT_PUBLIC_POSTHOG_ENABLED",
                "NEXT_PUBLIC_POSTHOG_KEY",
                "NEXT_PUBLIC_SENTRY_ENABLED",
                "NEXT_PUBLIC_SENTRY_DSN",
              ].includes(key),
            );
            assert.equal(typeof value, "string");
            args.push("--build-arg", `${key}=${value}`);
          }
        }
        run([...args, image.context], { stdio: "inherit" });
        return JSON.parse(readFileSync(metadata, "utf8"))[
          "containerimage.digest"
        ];
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    verify(image, reference) {
      run(["pull", reference], { stdio: "inherit" });
      const labels = JSON.parse(
        run([
          "image",
          "inspect",
          reference,
          "--format",
          "{{json .Config.Labels}}",
        ]),
      );
      assert.equal(labels["org.opencontainers.image.revision"], image.source);
      assert.equal(
        labels["org.opencontainers.image.source"],
        "https://github.com/miniaxolotl/grove",
      );
      assert.equal(
        labels["org.opencontainers.image.title"],
        `grove-${image.component}`,
      );
      execFileSync(
        process.execPath,
        ["scripts/testing/container-images.mjs", image.component, reference],
        { stdio: "inherit", timeout: 300_000 },
      );
    },
    mirror(source, target) {
      run(
        [
          "buildx",
          "imagetools",
          "create",
          "--prefer-index=false",
          "--tag",
          target,
          source,
        ],
        { stdio: "inherit" },
      );
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const plan = imagePlan(
      process.env.RELEASE_SOURCE_SHA,
      process.env.RELEASE_TAG,
    );
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      plan[0].source,
    );
    const io = productionIo(process.env);
    if (process.argv[2] === "preflight") preflightImages(plan, io);
    else if (process.argv[2] === "prepare") {
      const manifest = prepareImages(plan, io);
      writeFileSync(
        "container-images.json",
        JSON.stringify(manifest, null, 2) + "\n",
      );
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `digest=${manifest.images.api.digest}\n`,
      );
    } else {
      assert.equal(process.argv[2], "promote");
      promoteImages(
        plan,
        JSON.parse(readFileSync("container-images.json", "utf8")),
        io,
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
