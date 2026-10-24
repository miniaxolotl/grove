import type { Knex } from "knex";

export const speechCache = {
  name: "20261024_024_speech_cache",
  async up(db: Knex) {
    await db.raw(`
      -- Cache metadata belongs to the tracked object, not its short-lived request.
      -- Existing speech/ objects retain their original deadlines and lifecycle.
      ALTER TABLE export_objects
        ADD COLUMN speech_memory_id uuid,
        ADD COLUMN speech_text_hash text,
        ADD COLUMN speech_cache_key text,
        ADD COLUMN speech_sha256 text,
        ADD CONSTRAINT export_objects_speech_memory FOREIGN KEY(account_id,speech_memory_id)
          REFERENCES memories(account_id,id),
        ADD CONSTRAINT export_objects_speech_metadata CHECK (
          (speech_memory_id IS NULL AND speech_text_hash IS NULL AND speech_cache_key IS NULL AND speech_sha256 IS NULL)
          OR (speech_memory_id IS NOT NULL AND speech_text_hash IS NOT NULL AND speech_cache_key IS NOT NULL AND speech_sha256 IS NOT NULL
            AND speech_text_hash ~ '^[a-f0-9]{64}$' AND speech_cache_key ~ '^[a-f0-9]{64}$'
            AND speech_sha256 ~ '^[a-f0-9]{64}$' AND object_key LIKE 'narration/%'));
      CREATE INDEX export_objects_speech_cache ON export_objects(account_id,speech_cache_key)
        WHERE speech_cache_key IS NOT NULL;
      CREATE INDEX export_objects_speech_memory ON export_objects(account_id,speech_memory_id)
        WHERE speech_memory_id IS NOT NULL;

      -- Every write path (including Undo, imports and API edits) gets the same
      -- retention transition. Expired objects can already be claimed for removal:
      -- never revive one, even if its bytes have not been physically deleted yet.
      CREATE FUNCTION grove_speech_cache_text() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        UPDATE export_objects SET expires_at=CASE
          WHEN NEW.status='active' AND NEW.deleted_at IS NULL
            AND (NEW.expires_at IS NULL OR NEW.expires_at>now())
            AND speech_text_hash=encode(sha256(convert_to(NEW.content,'UTF8')),'hex')
          THEN coalesce(NEW.expires_at+interval '7 days','infinity'::timestamptz)
          ELSE least(expires_at,now()+interval '7 days') END
        WHERE account_id=NEW.account_id AND speech_memory_id=NEW.id AND expires_at>now();
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_speech_cache_text() FROM PUBLIC;
      CREATE TRIGGER speech_cache_text AFTER UPDATE OF content,status,deleted_at,expires_at ON memories
        FOR EACH ROW EXECUTE FUNCTION grove_speech_cache_text();
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
