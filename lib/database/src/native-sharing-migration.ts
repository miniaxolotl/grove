import type { Knex } from "knex";

export const nativeSharing = {
  name: "20261106_039_native_note_sharing",
  async up(db: Knex) {
    await db.raw(
      "ALTER TABLE connections ADD COLUMN sharing_enabled boolean NOT NULL DEFAULT false",
    );
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
