import type { Knex } from "knex";
import { softDeletion } from "./soft-deletion.ts";
import { queueDispatch } from "./queue-dispatch.ts";
import { incrementalBackfills } from "./backfill-migration.ts";
import { bulkWork } from "./bulk-migration.ts";

export const queueProcessing = {
  name: "20261022_014_queue_processing",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN work_claimed_at timestamptz;
      CREATE TABLE processing_control (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        epoch bigint NOT NULL DEFAULT 0, profiles jsonb NOT NULL DEFAULT '{}'
      );
      INSERT INTO processing_control DEFAULT VALUES;
      GRANT SELECT ON processing_control TO grove_runtime, grove_worker;
      ALTER TABLE jobs ADD COLUMN epoch bigint NOT NULL DEFAULT 0,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN dispatch_id uuid, ADD COLUMN dispatch_until timestamptz,
        ADD COLUMN lane text GENERATED ALWAYS AS
          (CASE WHEN kind='embedding' THEN 'indexing' ELSE 'enrichment' END) STORED;
      ALTER TABLE transactional_emails ADD COLUMN dispatch_id uuid, ADD COLUMN dispatch_until timestamptz;
      CREATE INDEX jobs_lane_due ON jobs(lane, due_at, account_id) WHERE failed_at IS NULL;
      CREATE FUNCTION grove_job_epoch() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, public, pg_temp AS $$
      BEGIN
        NEW.epoch := (SELECT epoch FROM processing_control WHERE singleton);
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_job_epoch() FROM PUBLIC;
      CREATE TRIGGER job_epoch BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION grove_job_epoch();

      CREATE TABLE background_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid REFERENCES accounts(id),
        kind text NOT NULL CHECK(kind IN ('export','account_cleanup','retention_cleanup','artifact_cleanup','model_backfill','import','connector_sync')),
        lane text GENERATED ALWAYS AS (CASE WHEN kind IN ('account_cleanup','retention_cleanup','artifact_cleanup') THEN 'maintenance' ELSE 'bulk' END) STORED,
        dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 250),
        payload jsonb NOT NULL DEFAULT '{}' CHECK(octet_length(payload::text)<=1048576),
        cursor jsonb NOT NULL DEFAULT '{}', result jsonb,
        status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','cancelled')),
        processed bigint NOT NULL DEFAULT 0 CHECK(processed>=0), total bigint CHECK(total>=0),
        attempts integer NOT NULL DEFAULT 0, failures integer NOT NULL DEFAULT 0,
        due_at timestamptz NOT NULL DEFAULT now(), lease_id uuid, lease_until timestamptz,
        dispatch_id uuid, dispatch_until timestamptz, dispatched_at timestamptz,
        error_code text, claimed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz, expires_at timestamptz,
        UNIQUE NULLS NOT DISTINCT(account_id,kind,dedupe_key),
        CHECK(account_id IS NOT NULL OR kind='model_backfill')
      );
      ALTER TABLE background_tasks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE background_tasks FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON background_tasks USING(account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE ON background_tasks TO grove_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON background_tasks TO grove_worker;
      CREATE INDEX background_tasks_due ON background_tasks(lane,due_at,account_id) WHERE status IN ('pending','running');
      CREATE INDEX background_tasks_account ON background_tasks(account_id,created_at DESC,id);
      CREATE INDEX background_tasks_leases ON background_tasks(account_id,lane,lease_until) WHERE status='running';

      CREATE FUNCTION grove_task_allowed(t background_tasks) RETURNS boolean LANGUAGE sql STABLE
        SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
        SELECT (t.account_id IS NULL AND t.kind='model_backfill') OR EXISTS(
          SELECT 1 FROM accounts a WHERE a.id=t.account_id AND
            (t.kind='artifact_cleanup' OR (a.status='active' AND t.kind<>'account_cleanup') OR (t.kind='account_cleanup' AND a.status IN ('deleting','deleted'))))
      $$;
      REVOKE ALL ON FUNCTION grove_task_allowed(background_tasks) FROM PUBLIC;

      CREATE FUNCTION grove_claim_task(wanted uuid, requested_lane text, account_limit integer) RETURNS SETOF background_tasks
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
      DECLARE candidate record; selected uuid; owner_id uuid; selected_lane text;
      BEGIN
        -- Expired attempts are reclaimed; the failure count bounds consecutive crashes.
        UPDATE background_tasks SET status='failed',error_code='lease_exhausted',finished_at=now(),updated_at=now(),lease_id=NULL,lease_until=NULL
          WHERE status IN ('pending','running') AND failures>=5 AND (lease_until IS NULL OR lease_until<now());
        FOR candidate IN SELECT t.id,t.account_id,t.lane FROM background_tasks t LEFT JOIN accounts a ON a.id=t.account_id
          WHERE (wanted IS NULL OR t.id=wanted) AND (requested_lane IS NULL OR t.lane=requested_lane)
            AND t.status IN ('pending','running') AND t.failures<5 AND t.due_at<=now()
            AND (t.lease_until IS NULL OR t.lease_until<now()) AND grove_task_allowed(t)
            AND (t.account_id IS NULL OR (SELECT count(*) FROM background_tasks busy WHERE busy.account_id=t.account_id
              AND busy.lane=t.lane AND busy.status='running' AND busy.lease_until>now()) < greatest(1,least(account_limit,32)))
          ORDER BY coalesce(a.work_claimed_at,t.claimed_at) NULLS FIRST,t.due_at,t.id LIMIT 32
        LOOP
        selected:=candidate.id; owner_id:=candidate.account_id; selected_lane:=candidate.lane;
        IF owner_id IS NOT NULL THEN
          -- Match mutation lock order: account before task. Recheck capacity after locking.
          PERFORM 1 FROM accounts WHERE id=owner_id FOR UPDATE SKIP LOCKED;
          IF NOT FOUND THEN CONTINUE; END IF;
          IF (SELECT count(*) FROM background_tasks WHERE account_id=owner_id AND status='running' AND lease_until>now()
            AND lane=selected_lane) >= greatest(1,least(account_limit,32)) THEN CONTINUE; END IF;
        END IF;
        PERFORM 1 FROM background_tasks t WHERE t.id=selected AND t.status IN ('pending','running')
          AND (t.lease_until IS NULL OR t.lease_until<now()) AND t.failures<5 AND t.due_at<=now()
          AND grove_task_allowed(t) FOR UPDATE SKIP LOCKED;
        IF NOT FOUND THEN CONTINUE; END IF;
        IF owner_id IS NOT NULL THEN UPDATE accounts SET work_claimed_at=now() WHERE id=owner_id; END IF;
        RETURN QUERY UPDATE background_tasks SET status='running',lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds',
          attempts=attempts+1,failures=failures+1,claimed_at=now(),updated_at=now() WHERE id=selected RETURNING *;
        RETURN;
        END LOOP;
      END $$;
      REVOKE ALL ON FUNCTION grove_claim_task(uuid,text,integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_claim_task(uuid,text,integer) TO grove_worker;

      CREATE FUNCTION grove_task_heartbeat(wanted uuid, token uuid) RETURNS boolean LANGUAGE sql
        SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
        WITH renewed AS (UPDATE background_tasks t SET lease_until=now()+interval '120 seconds'
          WHERE t.id=wanted AND t.lease_id=token AND t.status='running' AND t.lease_until>now() AND grove_task_allowed(t) RETURNING 1)
        SELECT EXISTS(SELECT 1 FROM renewed)
      $$;
      REVOKE ALL ON FUNCTION grove_task_heartbeat(uuid,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_task_heartbeat(uuid,uuid) TO grove_worker;

      CREATE FUNCTION grove_task_checkpoint(wanted uuid, token uuid, checkpoint jsonb, done_count bigint, outcome jsonb, complete boolean, retry_seconds integer)
        RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
        WITH saved AS (UPDATE background_tasks t SET cursor=checkpoint,processed=done_count,result=outcome,
          status=CASE WHEN complete THEN 'succeeded' ELSE 'pending' END,failures=0,error_code=NULL,
          finished_at=CASE WHEN complete THEN now() ELSE NULL END,updated_at=now(),
          lease_id=NULL,lease_until=NULL,dispatch_id=NULL,dispatch_until=NULL,dispatched_at=NULL,
          due_at=now()+greatest(0,least(retry_seconds,86400))*interval '1 second'
          WHERE t.id=wanted AND t.lease_id=token AND t.status='running' AND t.lease_until>now() AND grove_task_allowed(t) RETURNING 1)
        SELECT EXISTS(SELECT 1 FROM saved)
      $$;
      REVOKE ALL ON FUNCTION grove_task_checkpoint(uuid,uuid,jsonb,bigint,jsonb,boolean,integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_task_checkpoint(uuid,uuid,jsonb,bigint,jsonb,boolean,integer) TO grove_worker;

      CREATE FUNCTION grove_task_failure(wanted uuid, token uuid, code text, retryable boolean, retry_seconds integer)
        RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
        UPDATE background_tasks SET status=CASE WHEN retryable AND failures<5 THEN 'pending' ELSE 'failed' END,
          error_code=left(code,80),lease_id=NULL,lease_until=NULL,dispatch_id=NULL,dispatch_until=NULL,dispatched_at=NULL,updated_at=now(),
          finished_at=CASE WHEN retryable AND failures<5 THEN NULL ELSE now() END,
          due_at=now()+greatest(1,least(retry_seconds,3600))*interval '1 second'
        WHERE id=wanted AND lease_id=token AND status='running' AND lease_until>now()
      $$;
      REVOKE ALL ON FUNCTION grove_task_failure(uuid,uuid,text,boolean,integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_task_failure(uuid,uuid,text,boolean,integer) TO grove_worker;
    `);
    await softDeletion(db);
    await queueDispatch(db);
    await incrementalBackfills(db);
    await bulkWork(db);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
