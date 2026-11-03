import type { Knex } from "knex";

export const meetingPreparation = {
  name: "20261025_031_meeting_preparation",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN meeting_preparation_enabled boolean NOT NULL DEFAULT false;
      ALTER TABLE assistance_requests DROP CONSTRAINT assistance_requests_kind_check;
      ALTER TABLE assistance_requests ADD CONSTRAINT assistance_requests_kind_check
        CHECK(kind IN('filing','actions','digest','cleanup','meeting'));
      ALTER TABLE assistance_requests ADD COLUMN expires_at timestamptz;
      CREATE INDEX assistance_meeting_expiry ON assistance_requests(account_id,expires_at)
        WHERE kind='meeting' AND jsonb_exists(input,'agenda');
      CREATE FUNCTION grove_schedule_meeting_cleanup() RETURNS integer LANGUAGE plpgsql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE added integer;
      BEGIN
        WITH due AS (
          SELECT a.id FROM accounts a WHERE a.status='active'
            AND EXISTS(SELECT 1 FROM assistance_requests r WHERE r.account_id=a.id AND r.kind='meeting'
              AND r.expires_at<=now() AND jsonb_exists(r.input,'agenda'))
          ORDER BY a.work_claimed_at NULLS FIRST,a.id LIMIT 20
        ), inserted AS (
          INSERT INTO background_tasks(account_id,kind,dedupe_key)
            SELECT id,'retention_cleanup','lifecycle' FROM due
          ON CONFLICT(account_id,kind,dedupe_key) DO UPDATE SET status='pending',due_at=now(),updated_at=now(),
            finished_at=NULL,cursor='{}',processed=0,failures=0,error_code=NULL,dispatched_at=NULL,dispatch_id=NULL,dispatch_until=NULL
            WHERE background_tasks.status='succeeded'
          RETURNING 1
        ) SELECT count(*) INTO added FROM inserted;
        RETURN added;
      END $$;
      REVOKE ALL ON FUNCTION grove_schedule_meeting_cleanup() FROM PUBLIC,grove_runtime,grove_worker;
      GRANT EXECUTE ON FUNCTION grove_schedule_meeting_cleanup() TO grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
