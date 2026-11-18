import type { Knex } from "knex";

export const dailyNotes = {
  name: "20261117_042_daily_notes",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE daily_notes (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        local_date date NOT NULL,
        memory_id uuid,
        PRIMARY KEY (account_id, local_date),
        UNIQUE (account_id, memory_id),
        FOREIGN KEY (account_id, memory_id) REFERENCES memories(account_id,id)
          ON DELETE SET NULL (memory_id)
      );
      ALTER TABLE daily_notes ENABLE ROW LEVEL SECURITY;
      ALTER TABLE daily_notes FORCE ROW LEVEL SECURITY;
      CREATE POLICY daily_notes_tenant ON daily_notes
        USING (account_id=nullif(current_setting('grove.account_id',true),'')::uuid);
      GRANT SELECT, INSERT ON daily_notes TO grove_runtime;
      GRANT SELECT, DELETE ON daily_notes TO grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration; retain daily note identities");
  },
};
