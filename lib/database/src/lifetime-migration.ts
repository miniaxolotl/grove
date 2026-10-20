import type { Knex } from "knex";

export const memoryLifetimes = {
  name: "20261020_006_memory_lifetimes",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE memories DROP CONSTRAINT memories_check;
      ALTER TABLE memories ADD COLUMN retention_days integer CHECK (retention_days BETWEEN 1 AND 365);
      UPDATE memories SET retention_days = 30 WHERE expires_at IS NOT NULL;
      ALTER TABLE memories ADD CONSTRAINT memory_task_reference CHECK ((kind = 'handoff') = (task_id IS NOT NULL));
      ALTER TABLE memories ADD CONSTRAINT memory_lifetime CHECK (
        (retention_days IS NULL AND expires_at IS NULL AND purge_at IS NULL) OR
        (retention_days IS NOT NULL AND expires_at IS NOT NULL AND purge_at IS NOT NULL AND purge_at > expires_at)
      );
      CREATE INDEX memories_updated_page ON memories(account_id, updated_at DESC, id DESC);
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
