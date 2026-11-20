// One bounded complete page only. Never silently treat pagination as quiescence.
import assert from "node:assert/strict";
const need = (value) => assert(value, "INSTANCE_INVENTORY_REJECTED");
function json(value, depth = 0) {
  need(depth <= 24);
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    need(Number.isFinite(value));
    return value;
  }
  need(
    value &&
      typeof value === "object" &&
      (Array.isArray(value) ||
        Object.getPrototypeOf(value) === Object.prototype),
  );
  return Object.freeze(
    Array.isArray(value)
      ? value.map((v) => json(v, depth + 1))
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, json(value[k], depth + 1)]),
        ),
  );
}
function pagination(value, total, depth = 0) {
  need(
    depth <= 8 && value && typeof value === "object" && !Array.isArray(value),
  );
  for (const [key, v] of Object.entries(value)) {
    if (key === "total") need(Number.isSafeInteger(v) && v === total);
    if (/(?:next|prev|previous|cursor)/i.test(key))
      need(v === undefined || v === null || v === "" || v === false);
    if (v && typeof v === "object") pagination(v, total, depth + 1);
  }
}
export function validateCompleteInstanceInventory(page) {
  need(
    page &&
      typeof page === "object" &&
      Array.isArray(page.instances) &&
      page.instances.length <= 1000,
  );
  const { instances, ...envelope } = page;
  pagination(envelope, instances.length);
  for (const container of [page, page.meta, page.links, page.links?.meta])
    if (container && Object.hasOwn(container, "total"))
      need(
        Number.isSafeInteger(container.total) &&
          container.total === instances.length,
      );
  const seen = new Set(),
    rows = instances.map((row) => {
      need(
        row &&
          typeof row === "object" &&
          !Array.isArray(row) &&
          ["api", "worker"].includes(row.component_name) &&
          typeof row.instance_name === "string" &&
          /^[a-z0-9][a-z0-9-]{0,119}$/.test(row.instance_name),
      );
      const id = row.component_name + ":" + row.instance_name;
      need(!seen.has(id));
      seen.add(id);
      return json(row);
    });
  need(JSON.stringify(rows).length <= 2 * 1024 * 1024);
  rows.sort(
    (a, b) =>
      a.component_name.localeCompare(b.component_name) ||
      a.instance_name.localeCompare(b.instance_name),
  );
  return Object.freeze(rows);
}
export function assertInstanceInventoryUnchanged(actual, approved) {
  assert.deepEqual(
    validateCompleteInstanceInventory({ instances: actual }),
    validateCompleteInstanceInventory({ instances: approved }),
    "INSTANCE_INVENTORY_CHANGED",
  );
}
