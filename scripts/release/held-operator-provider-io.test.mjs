import test from "node:test";
import assert from "node:assert/strict";
import { receiptHash } from "./held-state.mjs";
const api = await import("./held-operator-provider-io.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
const { structuredClone } = globalThis;
test("CLI dispatch compares approved full inventory after its last awaited window check", async () => {
  assert.equal(typeof api.createProviderDispatch, "function");
  const spec = { new: true },
    command = { expected: "a", proposed: receiptHash(spec) };
  const approved = {
    state: "a",
    instances: [
      {
        component_name: "worker",
        instance_name: "worker-original",
        metadata: { revision: 1 },
      },
    ],
  };
  for (const change of ["restart", "metadata", "pagination"]) {
    let reads = 0,
      writes = 0;
    const put = api.createProviderDispatch({
      command,
      digest: "d",
      current: () => {},
      validate: () => {},
      external: {
        assertExclusiveWindow: async () => ({ expiresAt: Date.now() + 60000 }),
        prepareProviderWrite: async () => {},
      },
      observe: async () => {
        reads++;
        const value = structuredClone(approved);
        if (reads >= 3) {
          if (change === "restart")
            value.instances[0].instance_name = "worker-restarted";
          if (change === "metadata") value.instances[0].metadata.revision = 2;
          if (change === "pagination") return { ...value, instances: null };
        }
        return value;
      },
      submit: async () => {
        writes++;
      },
    });
    await assert.rejects(put(spec, approved), /INVENTORY/);
    assert.equal(writes, 0);
  }
});
