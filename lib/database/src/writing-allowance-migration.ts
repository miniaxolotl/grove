import type { Knex } from "knex";

export const writingAllowance = {
  name: "20261107_041_writing_allowance",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE action_usage DROP CONSTRAINT action_usage_metric_check;
      ALTER TABLE action_usage ADD CONSTRAINT action_usage_metric_check
        CHECK(metric IN ('recall','ask','organization','assistance','writing'));
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
