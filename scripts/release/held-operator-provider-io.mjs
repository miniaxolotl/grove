import assert from "node:assert/strict";
import {
  validateCompleteInstanceInventory,
  assertInstanceInventoryUnchanged,
} from "./held-instance-inventory.mjs";
// This is the CLI's actual innermost dispatch boundary, shared with regressions.
export function createProviderDispatch({
  observe,
  current,
  external,
  command,
  digest,
  validate,
  submit,
}) {
  return async (spec, approved) => {
    const inventory = validateCompleteInstanceInventory({
      instances: approved?.instances,
    });
    const check = (state) => {
      assert.equal(state.state, command.expected, "Provider generation drift");
      assertInstanceInventoryUnchanged(state.instances, inventory);
      return state;
    };
    current();
    await external.assertExclusiveWindow(command, check(await observe()), {
      digest,
    });
    const dispatch = check(await observe());
    await external.prepareProviderWrite(command, dispatch, { digest });
    const lease = await external.assertExclusiveWindow(command, dispatch, {
      digest,
    });
    current();
    check(await observe());
    // No awaited operation between the final complete roster read and dispatch.
    assert(
      Number.isSafeInteger(lease?.expiresAt) && lease.expiresAt > Date.now(),
      "WINDOW_LEASE_EXPIRED",
    );
    validate();
    await submit(spec);
  };
}
