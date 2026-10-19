import { createDatabase } from "@lib/database";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is required");
const db = createDatabase(url, { ssl: process.env.DATABASE_SSL === "require" });
try {
  await db.migrate.latest();
  for (const [name, role, password] of [
    ["grove_api", "grove_runtime", process.env.API_DATABASE_PASSWORD],
    ["grove_jobs", "grove_worker", process.env.WORKER_DATABASE_PASSWORD],
  ] as const) {
    if (!password || password.length < 16)
      throw new Error(
        "Runtime database passwords must have at least 16 characters",
      );
    const existing = await db.raw(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ?",
      [name],
    );
    if (!existing.rows.length) {
      const result = await db.raw(
        "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', ?::text, ?::text) AS statement",
        [name, password],
      );
      await db.raw(result.rows[0].statement);
    } else if (existing.rows[0].rolsuper || existing.rows[0].rolbypassrls)
      throw new Error("Runtime role has unsafe privileges");
    await db.raw("GRANT ?? TO ??", [role!, name!]);
  }
  console.log(JSON.stringify({ status: "schema-and-roles-ready" }));
} finally {
  await db.destroy();
}
