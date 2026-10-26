import type { Knex } from "knex";

export const adminSupport = {
  name: "20261025_027_admin_support",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN admin_suspended boolean NOT NULL DEFAULT false;
      ALTER TABLE account_administration ADD COLUMN support_note text NOT NULL DEFAULT '' CHECK(length(support_note)<=500);
      ALTER TABLE system_admin_audit DROP CONSTRAINT system_admin_audit_kind_check;
      ALTER TABLE system_admin_audit ADD CHECK(kind IN ('change','bootstrap','support'));
      CREATE INDEX accounts_admin_page ON accounts(created_at DESC,id DESC) WHERE status IN ('active','disabled');

      CREATE FUNCTION grove_admin_support_state(target uuid) RETURNS jsonb
        LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT jsonb_build_object('account',public.grove_admin_state(a.id),'settings',
          jsonb_build_object('captureEnabled',a.capture_enabled,'recallEnabled',a.recall_enabled,
            'suspended',a.admin_suspended,'supportNote',COALESCE(s.support_note,'')))
        FROM public.accounts a LEFT JOIN public.account_administration s ON s.account_id=a.id
        WHERE a.id=target AND a.status IN ('active','disabled')
      $$;
      CREATE FUNCTION grove_admin_browse(after_id uuid DEFAULT NULL) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE result jsonb; page jsonb; boundary timestamptz; total bigint;
        BEGIN
          PERFORM public.grove_admin_guard();
          IF after_id IS NOT NULL THEN
            SELECT created_at INTO boundary FROM public.accounts WHERE id=after_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'invalid_cursor' USING ERRCODE='GA002'; END IF;
          END IF;
          SELECT count(*) INTO total FROM public.accounts WHERE status IN ('active','disabled');
          SELECT COALESCE(jsonb_agg(public.grove_admin_state(id) ORDER BY created_at DESC,id DESC),'[]'::jsonb)
          INTO page FROM (SELECT id,created_at FROM public.accounts WHERE status IN ('active','disabled')
            AND (after_id IS NULL OR (created_at,id)<(boundary,after_id))
            ORDER BY created_at DESC,id DESC LIMIT 31) a;
          SELECT COALESCE(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO result
            FROM jsonb_array_elements(page) WITH ORDINALITY WHERE ordinality<=30;
          RETURN jsonb_build_object('accounts',result,'total',total,
            'nextCursor',CASE WHEN jsonb_array_length(page)>30 THEN result->29->>'accountId' ELSE NULL END);
        END $$;

      CREATE FUNCTION grove_admin_details(target uuid) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE result jsonb; original text; metrics jsonb; counts jsonb;
          today date := (now() AT TIME ZONE 'UTC')::date;
          month date := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
        BEGIN
          PERFORM public.grove_admin_guard();
          result := public.grove_admin_support_state(target);
          IF result IS NULL THEN RAISE EXCEPTION 'account_unavailable' USING ERRCODE='GA004'; END IF;
          -- Scope only these bounded aggregate queries to the target. Never expose
          -- a general-purpose cross-tenant reader or broaden any RLS policy.
          original := current_setting('grove.account_id',true);
          PERFORM set_config('grove.account_id',target::text,true);
          SELECT jsonb_object_agg(metric,jsonb_build_object('today',daily,'month',monthly)) INTO metrics FROM (
            SELECT 'generation' AS metric,COALESCE(sum(requests) FILTER(WHERE day=today),0) AS daily,COALESCE(sum(requests),0) AS monthly
              FROM public.inference_usage WHERE account_id=target AND role='generation' AND day BETWEEN month AND today
            UNION ALL SELECT 'research',COALESCE(sum(calls) FILTER(WHERE day=today),0),COALESCE(sum(calls),0)
              FROM public.research_account_usage WHERE account_id=target AND day BETWEEN month AND today
            UNION ALL SELECT 'transcription',COALESCE(sum(units) FILTER(WHERE day=today),0),COALESCE(sum(units),0)
              FROM public.speech_usage WHERE account_id=target AND kind='speech_transcribe' AND day BETWEEN month AND today
            UNION ALL SELECT 'synthesis',COALESCE(sum(duration_ms) FILTER(WHERE day=today),0),COALESCE(sum(duration_ms),0)
              FROM public.speech_usage WHERE account_id=target AND kind='speech_synthesize' AND day BETWEEN month AND today
          ) counters;
          SELECT jsonb_build_object(
            'notes',(SELECT count(*) FROM public.memories WHERE account_id=target AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now())),
            'notebooks',(SELECT count(*) FROM public.projects WHERE account_id=target AND deleted_at IS NULL),
            'connections',(SELECT count(*) FROM public.connections WHERE account_id=target AND deleted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()))
          ) INTO counts;
          PERFORM set_config('grove.account_id',original,true);
          RETURN result || jsonb_build_object('counts',counts,'usage',jsonb_build_object('metrics',metrics,
            'dailyResetAt',(today+interval '1 day') AT TIME ZONE 'UTC',
            'monthlyResetAt',(month+interval '1 month') AT TIME ZONE 'UTC'));
        EXCEPTION WHEN OTHERS THEN
          IF original IS NOT NULL THEN PERFORM set_config('grove.account_id',original,true); END IF;
          RAISE;
        END $$;

      CREATE FUNCTION grove_admin_support_change(target uuid,operation uuid,expected integer,
        expected_settings jsonb,wanted jsonb,explanation text) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE actor uuid; previous public.system_admin_audit; old jsonb; result jsonb;
        BEGIN
          actor := public.grove_admin_guard();
          IF operation IS NULL OR expected IS NULL OR expected<0 OR explanation IS NULL OR length(trim(explanation)) NOT BETWEEN 3 AND 300
            OR wanted IS NULL OR expected_settings IS NULL OR jsonb_typeof(wanted)<>'object'
            OR jsonb_typeof(wanted->'captureEnabled') IS DISTINCT FROM 'boolean'
            OR jsonb_typeof(wanted->'recallEnabled') IS DISTINCT FROM 'boolean'
            OR jsonb_typeof(wanted->'suspended') IS DISTINCT FROM 'boolean'
            OR jsonb_typeof(wanted->'supportNote') IS DISTINCT FROM 'string'
            OR length(wanted->>'supportNote')>500 OR (SELECT count(*) FROM jsonb_object_keys(wanted))<>4 THEN
            RAISE EXCEPTION 'invalid_request' USING ERRCODE='GA002';
          END IF;
          SELECT * INTO previous FROM public.system_admin_audit WHERE id=operation;
          IF FOUND THEN
            IF previous.kind<>'support' OR previous.actor_id IS DISTINCT FROM actor OR previous.account_id IS DISTINCT FROM target
              OR previous.reason IS DISTINCT FROM explanation OR previous.after->'settings' IS DISTINCT FROM wanted
              OR previous.before->'settings' IS DISTINCT FROM expected_settings
              OR (previous.before->>'version')::integer IS DISTINCT FROM expected THEN
              RAISE EXCEPTION 'operation_conflict' USING ERRCODE='GA003';
            END IF;
            RETURN jsonb_build_object('account',previous.after-'settings','settings',previous.after->'settings');
          END IF;
          PERFORM 1 FROM public.accounts WHERE id=target FOR UPDATE;
          old := public.grove_admin_support_state(target);
          IF old IS NULL THEN RAISE EXCEPTION 'account_unavailable' USING ERRCODE='GA004'; END IF;
          IF (old->'account'->>'version')::integer<>expected OR old->'settings' IS DISTINCT FROM expected_settings THEN
            RAISE EXCEPTION 'admin_version_conflict' USING ERRCODE='GA005';
          END IF;
          IF (wanted->>'suspended')::boolean AND (target=actor OR (old->'account'->>'role'='system_admin' AND NOT EXISTS(
            SELECT 1 FROM public.accounts a JOIN public.account_administration s ON s.account_id=a.id
            WHERE a.status='active' AND s.role='system_admin' AND a.id<>target))) THEN
            RAISE EXCEPTION 'last_system_admin' USING ERRCODE='GA006';
          END IF;
          UPDATE public.accounts SET capture_enabled=(wanted->>'captureEnabled')::boolean,
            recall_enabled=(wanted->>'recallEnabled')::boolean,admin_suspended=(wanted->>'suspended')::boolean,
            status=CASE WHEN (wanted->>'suspended')::boolean THEN 'disabled'
              WHEN admin_suspended AND NOT EXISTS(SELECT 1 FROM public.subject_authority s WHERE s.subject=clerk_subject AND (s.disabled OR s.deleted)) THEN 'active'
              ELSE status END WHERE id=target;
          INSERT INTO public.account_administration(account_id,version,support_note) VALUES(target,expected+1,wanted->>'supportNote')
            ON CONFLICT(account_id) DO UPDATE SET version=EXCLUDED.version,support_note=EXCLUDED.support_note;
          result := public.grove_admin_support_state(target);
          INSERT INTO public.system_admin_audit(id,actor_id,account_id,kind,reason,before,after)
            VALUES(operation,actor,target,'support',explanation,
              old->'account'||jsonb_build_object('settings',old->'settings'),
              result->'account'||jsonb_build_object('settings',result->'settings'));
          RETURN result;
        END $$;
      CREATE OR REPLACE FUNCTION grove_user_state(subject text,event_at bigint,disabled boolean) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        BEGIN
          UPDATE public.subject_authority s SET disabled=grove_user_state.disabled
            WHERE s.subject=grove_user_state.subject AND s.event_at=grove_user_state.event_at AND NOT s.deleted;
          IF NOT FOUND THEN RETURN; END IF;
          UPDATE public.accounts SET status=CASE WHEN disabled OR admin_suspended THEN 'disabled' ELSE 'active' END
            WHERE clerk_subject=subject AND status IN ('active','disabled');
        END $$;
      CREATE OR REPLACE FUNCTION grove_admin_change(target uuid,operation uuid,expected integer,
        wanted_role text,wanted_access text,explanation text) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE actor uuid; previous public.system_admin_audit; old jsonb; result jsonb;
        BEGIN
          actor := public.grove_admin_guard();
          IF wanted_role NOT IN ('user','system_admin') OR wanted_role IS NULL
            OR wanted_access NOT IN ('default','pro','unlimited') OR wanted_access IS NULL
            OR explanation IS NULL OR length(trim(explanation)) NOT BETWEEN 3 AND 300
            OR expected IS NULL OR expected<0 OR operation IS NULL THEN
            RAISE EXCEPTION 'invalid_request' USING ERRCODE='GA002';
          END IF;
          SELECT * INTO previous FROM public.system_admin_audit WHERE id=operation;
          IF FOUND THEN
            IF previous.kind<>'change' OR previous.actor_id IS DISTINCT FROM actor OR previous.account_id IS DISTINCT FROM target
              OR previous.reason IS DISTINCT FROM explanation
              OR previous.after->>'role' IS DISTINCT FROM wanted_role
              OR previous.after->>'access' IS DISTINCT FROM wanted_access
              OR (previous.before->>'version')::integer IS DISTINCT FROM expected THEN
              RAISE EXCEPTION 'operation_conflict' USING ERRCODE='GA003';
            END IF;
            RETURN previous.after;
          END IF;
          old := public.grove_admin_state(target);
          IF old IS NULL OR old->>'status'<>'active' THEN
            RAISE EXCEPTION 'account_unavailable' USING ERRCODE='GA004';
          END IF;
          IF (old->>'version')::integer<>expected THEN RAISE EXCEPTION 'admin_version_conflict' USING ERRCODE='GA005'; END IF;
          IF old->>'role'='system_admin' AND wanted_role='user' AND NOT EXISTS(
            SELECT 1 FROM public.account_administration s JOIN public.accounts a ON a.id=s.account_id
            WHERE s.role='system_admin' AND a.status='active' AND s.account_id<>target) THEN
            RAISE EXCEPTION 'last_system_admin' USING ERRCODE='GA006';
          END IF;
          INSERT INTO public.account_administration(account_id,role,access,version)
            VALUES(target,wanted_role,wanted_access,expected+1)
            ON CONFLICT(account_id) DO UPDATE SET role=EXCLUDED.role,access=EXCLUDED.access,version=EXCLUDED.version;
          result := public.grove_admin_state(target);
          INSERT INTO public.system_admin_audit(id,actor_id,account_id,kind,reason,before,after)
            VALUES(operation,actor,target,'change',explanation,old,result);
          RETURN result;
        END $$;
      REVOKE ALL ON FUNCTION grove_admin_support_state(uuid),grove_admin_browse(uuid),grove_admin_details(uuid),
        grove_admin_support_change(uuid,uuid,integer,jsonb,jsonb,text) FROM PUBLIC,grove_runtime,grove_worker;
      GRANT EXECUTE ON FUNCTION grove_admin_browse(uuid),grove_admin_details(uuid),
        grove_admin_support_change(uuid,uuid,integer,jsonb,jsonb,text) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
