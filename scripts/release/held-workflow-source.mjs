// Workflow-test normalization only. Publication still uses protected promotion
// admission and the strict released-source validator, never this helper.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolveHeldDecision, resolveHeldSource } from "./held-delivery.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const defaults = {
  git,
  read: (ref, path) => git("show", `${ref}:${path}`),
  exists: (ref, path) =>
    git("ls-tree", "--name-only", ref, "--", path) === path,
};

export function resolveHeldWorkflowSelection(source, api = defaults) {
  try {
    return resolveHeldSource(source, api);
  } catch (sourceError) {
    try {
      const version = JSON.parse(api.read(source, "package.json")).version;
      assert.match(version, /^\d+\.\d+\.\d+$/);
      const released = api.git("rev-parse", `refs/tags/v${version}^{commit}`);
      const tree = api.git("rev-parse", `${released}^{tree}`);
      assert.equal(api.git("rev-parse", `${source}^{tree}`), tree);
      api.git("merge-base", "--is-ancestor", released, source);
      const parents = (ref) =>
        api.git("show", "-s", "--format=%P", ref).split(" ");
      const wrapper = parents(source);
      assert.equal(
        wrapper.length,
        2,
        "Expected a frozen or final promotion wrapper",
      );
      if (wrapper[1] !== released) {
        const frozen = parents(wrapper[1]);
        assert.deepEqual(
          frozen,
          [wrapper[0], released],
          "Frozen/final promotion parents differ",
        );
        assert.equal(api.git("rev-parse", `${wrapper[1]}^{tree}`), tree);
      }
      const selection = resolveHeldDecision(released, true, api);
      assert(selection, "Tagged source has no held declaration");
      return selection;
    } catch (wrapperError) {
      throw new AggregateError(
        [sourceError, wrapperError],
        "Neither a valid held source nor its exact tagged promotion wrapper",
        { cause: wrapperError },
      );
    }
  }
}
