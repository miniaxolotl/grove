import type { Knex } from "knex";

export const adminUsageReports = {
  name: "20261025_034_admin_usage_reports",
  async up(db: Knex) {
    await db.raw(`
      -- Forced tenant RLS stays intact. This owner-only helper visits known
      -- accounts for fixed aggregate queries, never arbitrary SQL or content.
      CREATE FUNCTION grove_admin_usage_rows(first_day date,last_day date)
      RETURNS TABLE(account_id uuid,day date,feature text,used numeric,reserved numeric,
        requests bigint,cached bigint,fresh bigint,input_tokens numeric,output_tokens numeric)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE target uuid; original text := current_setting('grove.account_id',true);
      BEGIN
        PERFORM public.grove_admin_guard();
        FOR target IN SELECT a.id FROM public.accounts a LOOP
          PERFORM set_config('grove.account_id',target::text,true);
          RETURN QUERY SELECT target,a.report_day,a.metric,
            COALESCE(sum(a.units) FILTER(WHERE a.status='completed'),0)/5::numeric,
            COALESCE(sum(a.units) FILTER(WHERE a.status='reserved' AND a.lease_until>now()),0)/5::numeric,
            count(*) FILTER(WHERE a.status='completed'),
            count(*) FILTER(WHERE a.status='completed' AND a.units=1),
            count(*) FILTER(WHERE a.status='completed' AND a.units=5),0::numeric,0::numeric
          FROM (SELECT u.*,greatest(u.period,least((u.created_at AT TIME ZONE 'UTC')::date,
            (u.period+interval '1 month'-interval '1 day')::date)) AS report_day
            FROM public.action_usage u WHERE u.account_id=target
              AND u.period BETWEEN date_trunc('month',first_day)::date AND date_trunc('month',last_day)::date
              AND u.status IN ('completed','reserved')) a
          WHERE a.report_day BETWEEN first_day AND last_day GROUP BY a.report_day,a.metric;
          RETURN QUERY SELECT target,i.day,i.role,sum(i.requests)::numeric,0::numeric,
            sum(i.requests)::bigint,0::bigint,0::bigint,sum(i.input_tokens)::numeric,sum(i.output_tokens)::numeric
            FROM public.inference_usage i WHERE i.account_id=target AND i.day BETWEEN first_day AND last_day
            AND i.role IN ('embedding','decision','generation') GROUP BY i.day,i.role;
          RETURN QUERY SELECT target,r.day,'research'::text,sum(r.calls)::numeric,0::numeric,
            sum(r.calls)::bigint,0::bigint,0::bigint,0::numeric,0::numeric
            FROM public.research_account_usage r WHERE r.account_id=target AND r.day BETWEEN first_day AND last_day GROUP BY r.day;
          RETURN QUERY SELECT target,s.day,CASE WHEN s.kind='speech_transcribe' THEN 'transcription' ELSE 'synthesis' END,
            sum(CASE WHEN s.kind='speech_transcribe' THEN s.units ELSE s.duration_ms END)::numeric,0::numeric,
            sum(s.requests)::bigint,0::bigint,0::bigint,0::numeric,0::numeric
            FROM public.speech_usage s WHERE s.account_id=target AND s.day BETWEEN first_day AND last_day GROUP BY s.day,s.kind;
          RETURN QUERY SELECT target,NULL::date,'_notes'::text,count(*)::numeric,0::numeric,0::bigint,0::bigint,0::bigint,0::numeric,0::numeric
            FROM public.memories m WHERE m.account_id=target AND m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now());
          RETURN QUERY SELECT target,NULL::date,'_notebooks'::text,count(*)::numeric,0::numeric,0::bigint,0::bigint,0::bigint,0::numeric,0::numeric
            FROM public.projects p WHERE p.account_id=target AND p.deleted_at IS NULL;
          RETURN QUERY SELECT target,NULL::date,'_connections'::text,count(*)::numeric,0::numeric,0::bigint,0::bigint,0::bigint,0::numeric,0::numeric
            FROM public.connections c WHERE c.account_id=target AND c.deleted_at IS NULL AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>now());
        END LOOP;
        PERFORM set_config('grove.account_id',original,true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('grove.account_id',original,true); RAISE;
      END $$;
      CREATE FUNCTION grove_admin_usage_report(first_day date DEFAULT NULL,last_day date DEFAULT NULL,after_id uuid DEFAULT NULL)
      RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        PERFORM public.grove_admin_guard();
        IF (first_day IS NULL) IS DISTINCT FROM (last_day IS NULL) THEN RAISE EXCEPTION 'invalid_range' USING ERRCODE='GA002'; END IF;
        first_day:=COALESCE(first_day,date_trunc('month',now() AT TIME ZONE 'UTC')::date);
        last_day:=COALESCE(last_day,(now() AT TIME ZONE 'UTC')::date);
        IF last_day<first_day OR last_day-first_day>365 OR last_day>(now() AT TIME ZONE 'UTC')::date THEN
          RAISE EXCEPTION 'invalid_range' USING ERRCODE='GA002'; END IF;
        RETURN (WITH events AS MATERIALIZED (SELECT * FROM public.grove_admin_usage_rows(first_day,last_day)),
          metrics AS (SELECT e.feature,jsonb_build_object('used',sum(e.used),'reserved',sum(e.reserved),
            'requests',sum(e.requests),'cached',sum(e.cached),'fresh',sum(e.fresh),
            'inputTokens',sum(e.input_tokens),'outputTokens',sum(e.output_tokens)) AS data
            FROM events e WHERE e.day IS NOT NULL GROUP BY e.feature),
          days AS (SELECT e.day,e.feature,sum(e.used) AS used,sum(e.reserved) AS reserved,sum(e.requests) AS requests,
            sum(e.cached) AS cached,sum(e.fresh) AS fresh,sum(e.input_tokens) AS "inputTokens",sum(e.output_tokens) AS "outputTokens"
            FROM events e WHERE e.day IS NOT NULL GROUP BY e.day,e.feature),
          page AS MATERIALIZED (SELECT a.id FROM public.accounts a WHERE after_id IS NULL OR a.id>after_id ORDER BY a.id LIMIT 31),
          per_user AS (SELECT e.account_id,e.feature,jsonb_build_object('used',sum(e.used),'reserved',sum(e.reserved),
            'requests',sum(e.requests),'cached',sum(e.cached),'fresh',sum(e.fresh),
            'inputTokens',sum(e.input_tokens),'outputTokens',sum(e.output_tokens)) AS data
            FROM events e WHERE e.day IS NOT NULL AND e.account_id IN(SELECT p.id FROM page p) GROUP BY e.account_id,e.feature),
          users AS (SELECT p.id,public.grove_admin_state(p.id)||jsonb_build_object('metrics',
            COALESCE((SELECT jsonb_object_agg(u.feature,u.data) FROM per_user u WHERE u.account_id=p.id),'{}'::jsonb)) AS data
            FROM page p ORDER BY p.id LIMIT 30)
          SELECT jsonb_build_object('from',first_day,'to',last_day,'generatedAt',clock_timestamp(),
            'totals',jsonb_build_object('accounts',(SELECT count(*) FROM public.accounts),
              'activeUsers',(SELECT count(DISTINCT e.account_id) FROM events e WHERE e.day IS NOT NULL AND (e.requests>0 OR e.reserved>0)),
              'metrics',COALESCE((SELECT jsonb_object_agg(m.feature,m.data) FROM metrics m),'{}'::jsonb),
              'current',jsonb_build_object('notes',COALESCE((SELECT sum(e.used) FROM events e WHERE e.feature='_notes'),0),
                'notebooks',COALESCE((SELECT sum(e.used) FROM events e WHERE e.feature='_notebooks'),0),
                'connections',COALESCE((SELECT sum(e.used) FROM events e WHERE e.feature='_connections'),0))),
            'days',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day,d.feature) FROM days d),'[]'::jsonb),
            'users',jsonb_build_object('accounts',COALESCE((SELECT jsonb_agg(u.data ORDER BY u.id) FROM users u),'[]'::jsonb),
              'total',(SELECT count(*) FROM public.accounts),
              'nextCursor',CASE WHEN (SELECT count(*) FROM page)>30 THEN (SELECT max(u.id::text) FROM users u) ELSE NULL END)));
      END $$;
      REVOKE ALL ON FUNCTION grove_admin_usage_rows(date,date),grove_admin_usage_report(date,date,uuid) FROM PUBLIC,grove_runtime,grove_worker;
      GRANT EXECUTE ON FUNCTION grove_admin_usage_report(date,date,uuid) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
