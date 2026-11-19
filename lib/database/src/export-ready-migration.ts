import type { Knex } from "knex";

export const exportReadyEmail = {
  name: "20261119_046_export_ready_email",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE transactional_emails DROP CONSTRAINT transactional_emails_kind_check,
        ADD COLUMN fingerprint text,
        ADD COLUMN export_task_id uuid,
        ADD COLUMN export_preparation_id uuid,
        ADD CONSTRAINT transactional_emails_kind_check CHECK
          (kind IN ('welcome','connection_approved','connection_revoked','export_ready')),
        ADD CONSTRAINT transactional_emails_export_reference CHECK (
          (kind = 'export_ready' AND export_task_id IS NOT NULL AND export_preparation_id IS NOT NULL
            AND event_key = 'export_ready:' || export_task_id::text || ':' || export_preparation_id::text)
          OR (kind <> 'export_ready' AND export_task_id IS NULL AND export_preparation_id IS NULL)
        );
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
