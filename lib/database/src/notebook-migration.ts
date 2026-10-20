import type { Knex } from "knex";

export const nestedNotebooks = {
  name: "20261020_008_nested_notebooks",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE projects
        ADD COLUMN parent_id uuid,
        ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        ADD CONSTRAINT projects_parent_owner FOREIGN KEY (account_id, parent_id)
          REFERENCES projects(account_id, id) ON DELETE SET NULL (parent_id),
        ADD CONSTRAINT projects_not_own_parent CHECK (parent_id IS DISTINCT FROM id);
      CREATE INDEX projects_parent ON projects(account_id, parent_id);
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
