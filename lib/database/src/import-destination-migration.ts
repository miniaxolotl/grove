import type { Knex } from "knex";

export const importDestination = {
  name: "20261118_045_import_destination",
  async up(db: Knex) {
    await db.raw(
      "ALTER TABLE document_import_batches ADD COLUMN initial_destination jsonb NOT NULL DEFAULT 'null'",
    );
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
