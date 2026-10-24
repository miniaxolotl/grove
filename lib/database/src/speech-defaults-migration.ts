import type { Knex } from "knex";

export const speechDefaults = {
  name: "20261023_021_speech_defaults",
  async up(db: Knex) {
    // Change future accounts only; never overwrite a saved speech preference.
    await db.raw(
      "ALTER TABLE accounts ALTER COLUMN read_aloud_enabled SET DEFAULT true",
    );
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
