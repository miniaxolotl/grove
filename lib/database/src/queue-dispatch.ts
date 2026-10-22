import type { Knex } from "knex";

export async function queueDispatch(db: Knex) {
  await db.raw(`
    CREATE FUNCTION grove_job_due(j jobs, profiles text[]) RETURNS boolean LANGUAGE sql STABLE
      SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      SELECT j.failed_at IS NULL AND j.attempts<5 AND j.due_at<=now()
        AND (j.lease_until IS NULL OR j.lease_until<now())
        AND j.epoch=(SELECT epoch FROM processing_control WHERE singleton)
        AND (profiles IS NULL OR j.profile=ANY(profiles))
        AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=j.account_id AND a.status='active')
        AND (j.memory_id IS NULL OR EXISTS(SELECT 1 FROM memories m WHERE m.account_id=j.account_id AND m.id=j.memory_id
          AND m.version=j.version AND m.deleted_at IS NULL AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())))
        AND (j.kind NOT IN ('decision','relationship_scan') OR NOT EXISTS(SELECT 1 FROM jobs e WHERE e.account_id=j.account_id
          AND e.target=j.target AND e.kind='embedding' AND e.failed_at IS NULL AND e.epoch=j.epoch AND (profiles IS NULL OR e.profile=ANY(profiles))))
        AND (j.kind<>'notebook_profile' OR NOT EXISTS(SELECT 1 FROM jobs e JOIN memories m ON m.account_id=e.account_id AND m.id=e.memory_id
          WHERE e.account_id=j.account_id AND m.project_id::text=j.target AND e.kind='embedding' AND e.failed_at IS NULL AND e.epoch=j.epoch
          AND (profiles IS NULL OR e.profile=ANY(profiles))))
        AND (j.kind<>'brief' OR NOT EXISTS(SELECT 1 FROM jobs e WHERE e.account_id=j.account_id AND e.kind IN ('embedding','decision','organization')
          AND e.failed_at IS NULL AND e.epoch=j.epoch AND (profiles IS NULL OR e.profile=ANY(profiles))))
    $$;
    REVOKE ALL ON FUNCTION grove_job_due(jobs,text[]) FROM PUBLIC;

    CREATE FUNCTION grove_claim_processing(profiles text[], wanted uuid, requested_lane text, account_limit integer) RETURNS SETOF jobs
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE selected uuid; owner_id uuid; selected_lane text;
    BEGIN
      SELECT j.id,j.account_id,j.lane INTO selected,owner_id,selected_lane FROM jobs j JOIN accounts a ON a.id=j.account_id
        WHERE (wanted IS NULL OR j.id=wanted) AND (requested_lane IS NULL OR j.lane=requested_lane) AND grove_job_due(j,profiles)
          AND (SELECT count(*) FROM jobs busy WHERE busy.account_id=j.account_id AND busy.lane=j.lane AND busy.lease_until>now())
            < greatest(1,least(account_limit,32))
        ORDER BY a.work_claimed_at NULLS FIRST,j.due_at,j.id LIMIT 1;
      IF selected IS NULL THEN RETURN; END IF;
      PERFORM 1 FROM accounts WHERE id=owner_id AND status='active' FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN RETURN; END IF;
      IF (SELECT count(*) FROM jobs WHERE account_id=owner_id AND lane=selected_lane AND lease_until>now())
        >= greatest(1,least(account_limit,32)) THEN RETURN; END IF;
      PERFORM 1 FROM jobs j WHERE j.id=selected AND grove_job_due(j,profiles) FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN RETURN; END IF;
      UPDATE accounts SET work_claimed_at=now() WHERE id=owner_id;
      RETURN QUERY UPDATE jobs SET lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds',attempts=attempts+1
        WHERE id=selected RETURNING *;
    END $$;
    REVOKE ALL ON FUNCTION grove_claim_processing(text[],uuid,text,integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION grove_claim_processing(text[],uuid,text,integer) TO grove_worker;
    CREATE OR REPLACE FUNCTION grove_claim_job(profiles text[] DEFAULT NULL,wanted uuid DEFAULT NULL) RETURNS SETOF jobs
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      SELECT * FROM grove_claim_processing(profiles,wanted,NULL,2)
    $$;

    CREATE INDEX jobs_active_leases ON jobs(account_id,lane,lease_until) WHERE lease_id IS NOT NULL;
    CREATE FUNCTION grove_dispatch_claim(source text, requested_lane text, profiles text[], batch_size integer)
      RETURNS TABLE(id uuid,account_id uuid,kind text,lane text,dispatch_id uuid)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE relation text; eligible text; lane_expression text;
    BEGIN
      IF source='memory' THEN
        relation:='jobs'; eligible:='grove_job_due(q,$1) AND q.lane=$2'; lane_expression:='q.lane';
      ELSIF source='task' THEN
        relation:='background_tasks'; eligible:='grove_task_allowed(q) AND q.status IN (''pending'',''running'') AND q.failures<5 AND q.lane=$2'; lane_expression:='q.lane';
      ELSIF source='email' AND requested_lane='email' THEN
        relation:='transactional_emails'; eligible:='q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts<5 AND q.created_at>now()-interval ''23 hours'' AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=q.account_id AND a.status=''active'')'; lane_expression:='''email''::text';
      ELSE RETURN; END IF;
      RETURN QUERY EXECUTE format('
        WITH eligible AS (
          SELECT q.id,row_number() OVER(PARTITION BY q.account_id ORDER BY q.due_at,q.id) AS rank
          FROM public.%I q WHERE %s AND q.due_at<=now() AND (q.lease_until IS NULL OR q.lease_until<now())
            AND (q.dispatch_until IS NULL OR q.dispatch_until<now())
            AND (q.dispatched_at IS NULL OR q.dispatched_at<now()-interval ''15 seconds'')
        ), picked AS (
          SELECT q.id FROM public.%I q JOIN eligible e ON e.id=q.id WHERE e.rank<=4
            AND (q.dispatch_until IS NULL OR q.dispatch_until<now())
          ORDER BY e.rank,q.due_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT $3
        ) UPDATE public.%I q SET dispatch_id=gen_random_uuid(),dispatch_until=now()+interval ''30 seconds''
          FROM picked p WHERE q.id=p.id RETURNING q.id,q.account_id,$4::text,%s,q.dispatch_id',
        relation,eligible,relation,relation,lane_expression)
        USING profiles,requested_lane,greatest(1,least(batch_size,100)),source;
    END $$;
    REVOKE ALL ON FUNCTION grove_dispatch_claim(text,text,text[],integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION grove_dispatch_claim(text,text,text[],integer) TO grove_worker;

    CREATE FUNCTION grove_dispatch_finish(source text,wanted uuid,token uuid,confirmed boolean) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE relation text;
    BEGIN
      relation:=CASE source WHEN 'memory' THEN 'jobs' WHEN 'email' THEN 'transactional_emails' WHEN 'task' THEN 'background_tasks' END;
      IF relation IS NULL THEN RETURN; END IF;
      EXECUTE format('UPDATE public.%I SET dispatched_at=CASE WHEN $3 THEN now() ELSE NULL END,dispatch_id=NULL,dispatch_until=NULL WHERE id=$1 AND dispatch_id=$2',relation)
        USING wanted,token,confirmed;
    END $$;
    REVOKE ALL ON FUNCTION grove_dispatch_finish(text,uuid,uuid,boolean) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION grove_dispatch_finish(text,uuid,uuid,boolean) TO grove_worker;

    CREATE FUNCTION grove_queue_stats() RETURNS TABLE(lane text,pending bigint,running bigint,failed bigint,oldest_seconds double precision)
      LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      SELECT q.lane,count(*) FILTER(WHERE q.pending),count(*) FILTER(WHERE q.running),count(*) FILTER(WHERE q.failed),
        coalesce(extract(epoch FROM now()-min(q.due_at) FILTER(WHERE q.pending)),0)::double precision
      FROM (
        SELECT j.lane,j.due_at,j.failed_at IS NULL AND (j.lease_until IS NULL OR j.lease_until<now()) AS pending,
          j.lease_until>now() AS running,j.failed_at IS NOT NULL AS failed FROM jobs j WHERE j.epoch=(SELECT epoch FROM processing_control WHERE singleton)
        UNION ALL SELECT t.lane,t.due_at,t.status='pending',t.status='running',t.status='failed' FROM background_tasks t WHERE t.status IN ('pending','running','failed')
        UNION ALL SELECT 'email',e.due_at,e.failed_at IS NULL AND (e.lease_until IS NULL OR e.lease_until<now()),e.lease_until>now(),e.failed_at IS NOT NULL
          FROM transactional_emails e WHERE e.sent_at IS NULL
      ) q GROUP BY q.lane
    $$;
    REVOKE ALL ON FUNCTION grove_queue_stats() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION grove_queue_stats() TO grove_worker;
  `);
}
