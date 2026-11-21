import assert from "node:assert/strict";
import test from "node:test";
const api = await import("./held-instance-inventory.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});
const row = (component = "api", name = "api-123") => ({
  component_name: component,
  instance_name: name,
  status: { ready: true, restarts: 0 },
});
test("complete inventory retains full raw metadata, canonicalizes order, detaches and deeply freezes", () => {
  assert.equal(typeof api.validateCompleteInstanceInventory, "function");
  const page = {
    instances: [row("worker", "worker-123"), row()],
    meta: { total: 2 },
  };
  const actual = api.validateCompleteInstanceInventory(page);
  assert.equal(actual[0].component_name, "api");
  page.instances[1].status.ready = false;
  assert.equal(actual[0].status.ready, true);
  assert(Object.isFrozen(actual) && Object.isFrozen(actual[0].status));
  api.assertInstanceInventoryUnchanged(actual, [
    row(),
    row("worker", "worker-123"),
  ]);
  assert.throws(
    () =>
      api.assertInstanceInventoryUnchanged(
        [row()],
        [{ ...row(), status: { ready: true, restarts: 1 } }],
      ),
    /INVENTORY/,
  );
  assert.deepEqual(
    api.validateCompleteInstanceInventory({
      instances: [],
      meta: { total: 0 },
    }),
    [],
  );
});
test("all known top/meta/links pagination and incomplete totals veto complete inventory", () => {
  assert.equal(typeof api.validateCompleteInstanceInventory, "function");
  const flags = [
    "next",
    "prev",
    "previous",
    "next_cursor",
    "prev_cursor",
    "previous_cursor",
    "cursor",
  ];
  for (const key of flags)
    for (const nested of [
      (v) => v,
      (v) => ({ meta: v }),
      (v) => ({ links: v }),
      (v) => ({ links: { pages: v } }),
    ])
      assert.throws(
        () =>
          api.validateCompleteInstanceInventory({
            instances: [],
            ...nested({ [key]: "remaining" }),
          }),
        /INVENTORY/,
      );
  for (const total of [1, -1, 0.5, "0", null])
    assert.throws(
      () =>
        api.validateCompleteInstanceInventory({
          instances: [],
          meta: { total },
        }),
      /INVENTORY/,
    );
});
test("invalid identities, rows, metadata types, duplicates and excessive inventory fail closed", () => {
  assert.equal(typeof api.validateCompleteInstanceInventory, "function");
  for (const instances of [
    [null],
    [[]],
    [{ ...row(), component_name: "db" }],
    [{ ...row(), instance_name: 4 }],
    [{ ...row(), instance_name: "../escape" }],
    [{ ...row(), status: undefined }],
    [row(), row()],
    Array.from({ length: 1001 }, (_, i) => row("api", "api-" + i)),
  ])
    assert.throws(
      () => api.validateCompleteInstanceInventory({ instances }),
      /INVENTORY/,
    );
});
