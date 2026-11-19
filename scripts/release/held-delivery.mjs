// No active declaration is shipped. Selection is reviewed immutable source,
// never a workflow input that can change an admitted release's delivery scope.
import assert from "node:assert/strict";
import {
  receiptHash,
  publication,
  validateHeldContext,
  validateHeldBaseline,
} from "./held-state.mjs";
import { execFileSync } from "node:child_process";
import {
  assertManifestVersion,
  assertReleaseIntent,
} from "./release-intent.mjs";
import { assertCoordinatedStamp } from "./coordinated-stamp.mjs";

export const heldDecisionPath = "scripts/release/held-decision.json";
export function parseHeldDecision(bytes) {
  if (bytes === null) return null;
  const decision = JSON.parse(bytes);
  assert.deepEqual(
    Object.keys(decision).sort(),
    ["schema", "mode", "anchor", "app", "previousDigest"].sort(),
  );
  assert.equal(decision.schema, 1);
  assert.equal(decision.mode, "held-publication-only");
  assert.match(decision.app, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(decision.previousDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(decision.anchor, /^[a-f0-9]{40}$/);
  return decision;
}
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const defaults = {
  git,
  read: (ref, path) => git("show", `${ref}:${path}`),
  exists: (ref, path) =>
    git("ls-tree", "--name-only", ref, "--", path) === path,
};
export function resolveHeldDecision(source, released = false, api = defaults) {
  assert.match(source, /^[a-f0-9]{40}$/);
  if (!api.exists(source, heldDecisionPath)) return null;
  const bytes = api.read(source, heldDecisionPath),
    decision = parseHeldDecision(bytes);
  const declared = released ? api.git("rev-parse", `${source}^1`) : source;
  assert.equal(
    api.git("rev-parse", `${declared}^1`),
    decision.anchor,
    "Held declaration anchor drift",
  );
  assert.equal(
    api.git("diff", "--name-only", "--no-renames", decision.anchor, declared),
    heldDecisionPath,
    "Held declaration contains unreviewed source edits",
  );
  assert.equal(
    api.read(declared, heldDecisionPath),
    bytes,
    "Held declaration changed during release stamp",
  );
  const before = JSON.parse(api.read(declared, "package.json")).version;
  if (released) {
    const version = JSON.parse(api.read(source, "package.json")).version;
    const messages = api
      .git(
        "log",
        "--first-parent",
        "--format=%B%x00",
        `v${before}..${declared}`,
      )
      .split("\0");
    assertManifestVersion(
      before,
      version,
      assertReleaseIntent(messages, before),
    );
    assert(
      version !== before,
      "A new immutable held source version is required",
    );
    assertCoordinatedStamp(declared, source, version, {
      git: api.git,
      read: (...args) => JSON.parse(api.read(...args)),
    });
  }
  return { manifest: decision, hash: receiptHash(decision), declared };
}
// Source Release runs on both declaration and version-stamp pushes. Neither
// shape may inherit the declaration onto arbitrary later source changes.
export function resolveHeldSource(source, api = defaults) {
  try {
    return resolveHeldDecision(source, false, api);
  } catch (declarationError) {
    try {
      return resolveHeldDecision(source, true, api);
    } catch (stampError) {
      throw new AggregateError(
        [declarationError, stampError],
        "Neither a valid held source declaration nor its coordinated stamp",
        { cause: stampError },
      );
    }
  }
}
function identity(context) {
  validateHeldContext(context);
  return Object.fromEntries(
    ["source", "production", "tree", "tag", "apiVersion", "run", "attempt"].map(
      (key) => [key, context[key]],
    ),
  );
}
export function pendingPublication(
  context,
  decision,
  baseline,
  now = Date.now(),
) {
  parseHeldDecision(JSON.stringify(decision));
  validateHeldBaseline(baseline);
  assert.equal(baseline.app, decision.app);
  assert.equal(baseline.digest, decision.previousDigest);
  const previous = context.pendingParent ?? null;
  if (previous) {
    assert.deepEqual(Object.keys(previous).sort(), ["attempt", "hash", "run"]);
    assert.match(previous.hash, /^[a-f0-9]{64}$/);
    for (const key of ["run", "attempt"])
      assert(Number.isSafeInteger(previous[key]) && previous[key] > 0);
  }
  return {
    schema: 1,
    phase: "publication_pending",
    release: identity(context),
    decisionHash: receiptHash(decision),
    baseline,
    at: new Date(now).toISOString(),
    publicReleased: false,
    schemaGate: "required_before_restore",
    previous,
  };
}
export async function completePublication(
  pending,
  context,
  decision,
  digest,
  verify,
  now = Date.now(),
) {
  const expected = pendingPublication(
    context,
    decision,
    pending.baseline,
    Date.parse(pending.at),
  );
  assert.deepEqual(pending, expected, "Pending publication identity changed");
  assert.equal(
    typeof verify,
    "function",
    "Actual registry/image verification is required",
  );
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  const verification = await verify();
  assert.deepEqual(Object.keys(verification).sort(), ["images", "packages"]);
  for (const value of Object.values(verification))
    assert.match(value, /^[a-f0-9]{64}$/);
  const receipt = publication(
    { ...context, baseline: pending.baseline },
    digest,
    now,
  );
  receipt.evidence = {
    baseline: pending.baseline,
    decisionHash: receiptHash(decision),
    pendingHash: receiptHash(pending),
    verification,
    publicReleased: false,
  };
  return receipt;
}
