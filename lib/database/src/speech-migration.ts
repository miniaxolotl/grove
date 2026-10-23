import type { Knex } from "knex";

export const speech = {
  name: "20261023_019_speech",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts
        ADD COLUMN transcription_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN read_aloud_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN transcription_version integer NOT NULL DEFAULT 0,
        ADD COLUMN read_aloud_version integer NOT NULL DEFAULT 0;
      ALTER TABLE background_tasks DROP CONSTRAINT background_tasks_kind_check,
        ADD CONSTRAINT background_tasks_kind_check CHECK(kind IN
          ('export','account_cleanup','retention_cleanup','artifact_cleanup','model_backfill','import','connector_sync','speech_transcribe','speech_synthesize'));
      CREATE TABLE speech_configuration (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        transcription text, synthesis text
      );
      INSERT INTO speech_configuration(singleton) VALUES(true);
      GRANT SELECT ON speech_configuration TO grove_runtime,grove_worker;
      GRANT UPDATE ON speech_configuration TO grove_runtime;
      CREATE TABLE speech_usage (
        account_id uuid NOT NULL REFERENCES accounts(id), day date NOT NULL DEFAULT CURRENT_DATE,
        kind text NOT NULL CHECK(kind IN ('speech_transcribe','speech_synthesize')),
        requests integer NOT NULL DEFAULT 0 CHECK(requests>=0), units integer NOT NULL DEFAULT 0 CHECK(units>=0),
        PRIMARY KEY(account_id,day,kind)
      );
      ALTER TABLE speech_usage ENABLE ROW LEVEL SECURITY;
      ALTER TABLE speech_usage FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON speech_usage USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE ON speech_usage TO grove_runtime,grove_worker;

      CREATE FUNCTION grove_speech_session_active(wanted uuid) RETURNS boolean LANGUAGE sql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT EXISTS(SELECT 1 FROM background_tasks t JOIN accounts a ON a.id=t.account_id
          WHERE t.id=wanted AND t.account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid
            AND t.kind IN ('speech_transcribe','speech_synthesize') AND a.status='active'
            AND NOT EXISTS(SELECT 1 FROM session_revocations r WHERE r.id=t.payload->>'sessionId'))
      $$;
      REVOKE ALL ON FUNCTION grove_speech_session_active(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_speech_session_active(uuid) TO grove_runtime,grove_worker;

      CREATE FUNCTION grove_expire_speech() RETURNS integer LANGUAGE plpgsql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE changed integer;
      BEGIN
        WITH expired AS (SELECT id FROM background_tasks
          WHERE kind IN ('speech_transcribe','speech_synthesize') AND expires_at<=now()
            AND result IS NOT NULL ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)
        UPDATE background_tasks SET result=NULL WHERE id IN (SELECT id FROM expired);
        GET DIAGNOSTICS changed=ROW_COUNT;
        RETURN changed;
      END $$;
      REVOKE ALL ON FUNCTION grove_expire_speech() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_expire_speech() TO grove_worker;

      CREATE FUNCTION grove_speech_preferences() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF OLD.transcription_enabled IS DISTINCT FROM NEW.transcription_enabled THEN
          NEW.transcription_version:=OLD.transcription_version+1;
          UPDATE background_tasks SET status='cancelled',lease_id=NULL,lease_until=NULL,finished_at=now(),updated_at=now()
            WHERE account_id=NEW.id AND kind='speech_transcribe' AND status IN ('pending','running');
        END IF;
        IF OLD.read_aloud_enabled IS DISTINCT FROM NEW.read_aloud_enabled THEN
          NEW.read_aloud_version:=OLD.read_aloud_version+1;
          UPDATE background_tasks SET status='cancelled',lease_id=NULL,lease_until=NULL,finished_at=now(),updated_at=now()
            WHERE account_id=NEW.id AND kind='speech_synthesize' AND status IN ('pending','running');
        END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_speech_preferences() FROM PUBLIC;
      CREATE TRIGGER speech_preferences BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION grove_speech_preferences();

      -- Short-lived provider slots have no tenant-readable surface. The provider's
      -- 45s deadline is shorter than the 90s slot even if a process disappears.
      CREATE TABLE speech_slots(task_id uuid PRIMARY KEY,lease_id uuid NOT NULL,expires_at timestamptz NOT NULL);
      CREATE FUNCTION grove_speech_acquire(wanted uuid,token uuid,maximum integer) RETURNS boolean
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(68142020);
        IF NOT EXISTS(SELECT 1 FROM background_tasks t WHERE t.id=wanted AND t.lease_id=token
          AND t.status='running' AND t.lease_until>now() AND t.kind IN ('speech_transcribe','speech_synthesize') AND grove_task_allowed(t)) THEN RETURN false; END IF;
        DELETE FROM speech_slots WHERE expires_at<=now();
        IF (SELECT count(*) FROM speech_slots)>=greatest(1,least(maximum,16)) THEN RETURN false; END IF;
        INSERT INTO speech_slots VALUES(wanted,token,now()+interval '90 seconds') ON CONFLICT DO NOTHING;
        RETURN FOUND;
      END $$;
      CREATE FUNCTION grove_speech_release(wanted uuid,token uuid) RETURNS void LANGUAGE sql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DELETE FROM speech_slots WHERE task_id=wanted AND lease_id=token
      $$;
      REVOKE ALL ON FUNCTION grove_speech_acquire(uuid,uuid,integer),grove_speech_release(uuid,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_speech_acquire(uuid,uuid,integer),grove_speech_release(uuid,uuid) TO grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
