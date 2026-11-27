import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createDatabase, tenant } from "@lib/database";
import { MemoryService, sessionPrincipal } from "@lib/memory";

const db = createDatabase(process.env.TEST_DATABASE_URL!);
const service = new MemoryService(db, "notebook-display-sort-fixture");
after(() => db.destroy());

test("the complete owner catalog exposes actual immutable creation dates without inventing edited dates", async () => {
  const subject = `notebook_dates_${randomUUID()}`;
  const { rows } = await db.raw("SELECT * FROM grove_account(?)", [subject]);
  const principal = sessionPrincipal(rows[0].id, subject);
  const notebook = await service.project(principal, {
    name: "Field records",
    identity: randomUUID(),
  });
  const date = "2026-10-01T11:22:33.000Z";
  await tenant(db, principal.accountId, (trx) =>
    trx("projects")
      .where({ id: notebook.id })
      .update({ createdAt: new Date(date) }),
  );
  const first = await service.projectCatalog(principal, { limit: 1 });
  assert.equal(first.items[0].createdAt, date);
  assert(!Object.hasOwn(first.items[0], "updatedAt"));
  await service.project(
    principal,
    {
      name: "Renamed field records",
      identity: notebook.identity,
      expectedVersion: notebook.version,
    },
    notebook.id,
  );
  const renamed = await service.projectCatalog(principal, {});
  assert.equal(renamed.items[0].createdAt, date);
  assert.equal(renamed.items[0].name, "Renamed field records");
});
