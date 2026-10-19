import { createDatabase } from "@lib/database";

const url = process.env.TEST_MIGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw new Error("Use a dedicated database ending in _test");
const db = createDatabase(url);
try {
  await db.migrate.latest();
  for (const [name, role, password] of [
    ["grove_api", "grove_runtime", "grove_disposable_api"],
    ["grove_jobs", "grove_worker", "grove_disposable_worker"],
  ]) {
    const existing = await db.raw("SELECT 1 FROM pg_roles WHERE rolname = ?", [
      name,
    ]);
    if (!existing.rows.length) {
      const result = await db.raw(
        "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', ?::text, ?::text) AS statement",
        [name, password],
      );
      await db.raw(result.rows[0].statement);
    }
    await db.raw("GRANT ?? TO ??", [role, name]);
  }
} finally {
  await db.destroy();
}
