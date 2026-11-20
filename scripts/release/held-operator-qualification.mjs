import assert from "node:assert/strict";
import { receiptHash } from "./held-state.mjs";

export async function qualifyIndependent(context, scope) {
  const { current, plans, manifest, command, validateCustody, external } =
    context;
  assert.equal(typeof scope?.consume, "boolean");
  assert.deepEqual(scope, {
    source: command.source,
    publication: command.publication,
    command: receiptHash(command),
    action: command.action,
    consume: scope.consume,
  });
  current();
  const fresh = await plans.operatorManifest({
    readOnly: scope.consume === false,
  });
  assert(
    fresh.executionAdmitted && !fresh.hardBlock,
    "Independent operator is not qualified",
  );
  assert.equal(fresh.contract, "source-bound-held-release-v1");
  assert.equal(fresh.hash, manifest.hash);
  assert.equal(fresh.source, command.source);
  await validateCustody();
  const result = await external.qualify(scope, { command });
  assert(
    result.executionAdmitted && !result.hardBlock,
    "Independent operator is not qualified",
  );
  assert.equal(result.contract, "source-bound-held-release-v1");
  assert.equal(result.source, command.source);
  assert.equal(result.manifest, command.manifest);
  assert.equal(result.custody, command.custody);
  return result;
}
