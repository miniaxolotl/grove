import type { Knex } from "knex";

export const noteCapacity = {
  name: "20261127_049_note_capacity",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE memories DROP CONSTRAINT memories_content_check;
      ALTER TABLE memories ADD CONSTRAINT memories_content_check
        CHECK (length(content) BETWEEN 1 AND 250000);
      ALTER TABLE document_import_notes DROP CONSTRAINT document_import_notes_content_check;
      ALTER TABLE document_import_notes ADD CONSTRAINT document_import_notes_content_check
        CHECK (length(content) BETWEEN 1 AND 250000);
    `);
  },
  async down() {
    throw new Error("Use a forward migration; retain long notes");
  },
};
