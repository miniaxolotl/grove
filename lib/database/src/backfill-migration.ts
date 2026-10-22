import type { Knex } from "knex";

export async function incrementalBackfills(db: Knex) {
  await db.raw(`
    CREATE OR REPLACE FUNCTION grove_reprocess(embedding_profile text,decision_profile text,generation_profile text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE generation bigint;
    BEGIN
      PERFORM pg_advisory_xact_lock(68142019);
      UPDATE processing_control SET epoch=epoch+1,profiles=jsonb_build_object('embedding',embedding_profile,'decision',decision_profile,'generation',generation_profile)
        WHERE singleton RETURNING epoch INTO generation;
      UPDATE background_tasks SET status='cancelled',finished_at=now(),updated_at=now(),lease_id=NULL,lease_until=NULL
        WHERE kind='model_backfill' AND status IN ('pending','running');
      INSERT INTO background_tasks(kind,dedupe_key,payload)
        VALUES('model_backfill',generation::text,jsonb_build_object('epoch',generation));
    END $$;

    CREATE FUNCTION grove_backfill_batch(wanted uuid,token uuid,batch_size integer) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE task background_tasks; control processing_control; owner accounts;
      selected uuid[]; last_id uuid; completed_count integer; last_owner uuid; after_note uuid;
    BEGIN
      PERFORM pg_advisory_xact_lock_shared(68142019);
      SELECT * INTO task FROM background_tasks WHERE id=wanted AND lease_id=token AND status='running'
        AND kind='model_backfill' AND lease_until>now() FOR UPDATE;
      IF NOT FOUND THEN RETURN false; END IF;
      SELECT * INTO control FROM processing_control WHERE singleton;
      IF (task.payload->>'epoch')::bigint IS DISTINCT FROM control.epoch THEN
        UPDATE background_tasks SET status='cancelled',lease_id=NULL,lease_until=NULL,updated_at=now(),finished_at=now() WHERE id=task.id;
        RETURN false;
      END IF;
      last_owner:=(task.cursor->>'accountId')::uuid;
      after_note:=(task.cursor->>'afterId')::uuid;
      SELECT * INTO owner FROM accounts WHERE status='active'
        AND (last_owner IS NULL OR id>last_owner OR (id=last_owner AND after_note IS NOT NULL)) ORDER BY id LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM grove_task_checkpoint(task.id,token,task.cursor,task.processed,task.result,true,0);
        RETURN true;
      END IF;
      IF owner.id IS DISTINCT FROM last_owner THEN after_note:=NULL; END IF;
      SELECT array_agg(id ORDER BY id) INTO selected FROM (
        SELECT id FROM memories WHERE account_id=owner.id AND deleted_at IS NULL AND status='active'
          AND (expires_at IS NULL OR expires_at>now()) AND (after_note IS NULL OR id>after_note)
        ORDER BY id LIMIT greatest(1,least(batch_size,250))
      ) page;
      completed_count:=coalesce(cardinality(selected),0);
      last_id:=selected[completed_count];
      -- Old generations are removed incrementally, never in the settings request.
      DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE account_id=owner.id AND epoch<control.epoch ORDER BY id LIMIT 1000);
      IF EXISTS(SELECT 1 FROM jobs WHERE account_id=owner.id AND epoch<control.epoch) THEN
        PERFORM grove_task_checkpoint(task.id,token,jsonb_build_object('accountId',owner.id,'afterId',coalesce(after_note,'00000000-0000-0000-0000-000000000000'::uuid)),task.processed,NULL,false,0);
        RETURN true;
      END IF;
      INSERT INTO jobs(account_id,memory_id,version,target,kind,profile)
        SELECT m.account_id,m.id,m.version,m.id::text,p.kind,p.profile FROM memories m
        CROSS JOIN (VALUES ('embedding',control.profiles->>'embedding'),('decision',control.profiles->>'decision'),('organization',control.profiles->>'generation')) p(kind,profile)
        WHERE m.account_id=owner.id AND m.id=ANY(selected) AND p.profile IS NOT NULL
          AND (p.kind='embedding' OR (p.kind='decision' AND owner.classification_enabled) OR (p.kind='organization' AND owner.titles_tags_enabled))
        ON CONFLICT(account_id,kind,target,profile) DO UPDATE SET version=EXCLUDED.version,epoch=EXCLUDED.epoch,
          attempts=0,failed_at=NULL,error_code=NULL,lease_id=NULL,lease_until=NULL,dispatch_id=NULL,dispatch_until=NULL,dispatched_at=NULL,due_at=now()
          WHERE jobs.epoch<>EXCLUDED.epoch OR jobs.version IS DISTINCT FROM EXCLUDED.version;
      IF control.profiles->>'generation' IS NOT NULL THEN
        INSERT INTO jobs(account_id,kind,target,profile,scope,due_at)
          SELECT DISTINCT owner.id,'brief',coalesce(m.project_id::text,'personal'),control.profiles->>'generation',
            jsonb_build_object('projectId',m.project_id),now()+interval '5 seconds'
          FROM memories m WHERE m.account_id=owner.id AND m.id=ANY(selected)
            AND CASE WHEN m.project_id IS NULL THEN owner.personal_summary_enabled ELSE owner.notebook_summaries_enabled END
          ON CONFLICT(account_id,kind,target,profile) DO UPDATE SET epoch=EXCLUDED.epoch,attempts=0,failed_at=NULL,error_code=NULL,
            lease_id=NULL,lease_until=NULL,dispatched_at=NULL,dispatch_id=NULL,dispatch_until=NULL,due_at=EXCLUDED.due_at
            WHERE jobs.epoch<>EXCLUDED.epoch;
        INSERT INTO jobs(account_id,kind,target,profile,scope,due_at)
          SELECT owner.id,'brief',coalesce(m.project_id::text,'personal')||':task:'||m.task_id,control.profiles->>'generation',
            jsonb_build_object('projectId',m.project_id,'taskId',m.task_id),now()+interval '5 seconds'
          FROM memories m WHERE m.account_id=owner.id AND m.id=ANY(selected) AND m.task_id IS NOT NULL AND owner.progress_summaries_enabled
          ON CONFLICT(account_id,kind,target,profile) DO UPDATE SET epoch=EXCLUDED.epoch,attempts=0,failed_at=NULL,error_code=NULL,
            lease_id=NULL,lease_until=NULL,dispatched_at=NULL,dispatch_id=NULL,dispatch_until=NULL,due_at=EXCLUDED.due_at
            WHERE jobs.epoch<>EXCLUDED.epoch;
      END IF;
      UPDATE accounts SET organization_due_at=now() WHERE id=owner.id;
      PERFORM grove_task_checkpoint(task.id,token,jsonb_build_object('accountId',owner.id,'afterId',
        CASE WHEN completed_count>=greatest(1,least(batch_size,250)) THEN last_id ELSE NULL END),
        task.processed+completed_count,NULL,false,0);
      RETURN true;
    END $$;
    REVOKE ALL ON FUNCTION grove_backfill_batch(uuid,uuid,integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION grove_backfill_batch(uuid,uuid,integer) TO grove_worker;
  `);
}
