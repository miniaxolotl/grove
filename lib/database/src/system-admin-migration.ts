import type { Knex } from "knex";

export const systemAdministration = {
  name: "20261025_025_system_administration",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE account_administration (
        account_id uuid PRIMARY KEY REFERENCES public.accounts(id),
        role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','system_admin')),
        access text NOT NULL DEFAULT 'default' CHECK (access IN ('default','pro','unlimited')),
        version integer NOT NULL DEFAULT 0 CHECK (version >= 0)
      );
      ALTER TABLE account_administration ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON account_administration FOR SELECT
        USING (account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid);
      CREATE TABLE system_admin_audit (
        id uuid PRIMARY KEY, actor_id uuid REFERENCES public.accounts(id),
        account_id uuid NOT NULL REFERENCES public.accounts(id),
        kind text NOT NULL CHECK (kind IN ('change','bootstrap')),
        reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
        before jsonb NOT NULL, after jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX system_admin_audit_recent ON system_admin_audit(created_at DESC, id);
      ALTER TABLE system_admin_audit ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON account_administration,system_admin_audit FROM PUBLIC,grove_runtime,grove_worker;
      GRANT SELECT ON account_administration TO grove_runtime,grove_worker;

      CREATE FUNCTION grove_admin_state(target uuid) RETURNS jsonb
        LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
          SELECT jsonb_build_object('accountId',a.id,'subject',a.clerk_subject,
            'status',a.status,'createdAt',a.created_at,
            'role',COALESCE(s.role,'user'),'access',COALESCE(s.access,'default'),
            'version',COALESCE(s.version,0))
          FROM public.accounts a LEFT JOIN public.account_administration s ON s.account_id=a.id
          WHERE a.id=target
        $$;
      CREATE FUNCTION grove_admin_guard() RETURNS uuid
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE actor uuid := NULLIF(current_setting('grove.account_id',true),'')::uuid;
        BEGIN
          -- A fresh role snapshot after the lock wait fences concurrent revocation.
          PERFORM pg_advisory_xact_lock(68142025);
          IF NOT EXISTS(SELECT 1 FROM public.account_administration s
            JOIN public.accounts a ON a.id=s.account_id
            WHERE s.account_id=actor AND s.role='system_admin' AND a.status='active') THEN
            RAISE EXCEPTION 'system_admin_required' USING ERRCODE='GA001';
          END IF;
          RETURN actor;
        END $$;
      CREATE FUNCTION grove_admin_accounts(wanted text[] DEFAULT NULL) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE result jsonb;
        BEGIN
          PERFORM public.grove_admin_guard();
          SELECT COALESCE(jsonb_agg(public.grove_admin_state(a.id) ORDER BY a.created_at DESC,a.id),'[]'::jsonb)
          INTO result FROM (SELECT id,created_at FROM public.accounts
            WHERE status IN ('active','disabled') AND (wanted IS NULL OR clerk_subject=ANY(wanted))
            ORDER BY created_at DESC,id LIMIT 30) a;
          RETURN result;
        END $$;
      CREATE FUNCTION grove_admin_change(target uuid, operation uuid, expected integer,
        wanted_role text, wanted_access text, explanation text) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE actor uuid; previous public.system_admin_audit; old jsonb; result jsonb;
        BEGIN
          actor := public.grove_admin_guard();
          IF wanted_role NOT IN ('user','system_admin') OR wanted_role IS NULL
            OR wanted_access NOT IN ('default','pro','unlimited') OR wanted_access IS NULL
            OR explanation IS NULL OR length(trim(explanation)) NOT BETWEEN 3 AND 300
            OR expected IS NULL OR expected < 0 OR operation IS NULL THEN
            RAISE EXCEPTION 'invalid_request' USING ERRCODE='GA002';
          END IF;
          SELECT * INTO previous FROM public.system_admin_audit WHERE id=operation;
          IF FOUND THEN
            IF previous.actor_id IS DISTINCT FROM actor OR previous.account_id IS DISTINCT FROM target
              OR previous.reason IS DISTINCT FROM explanation
              OR previous.after->>'role' IS DISTINCT FROM wanted_role
              OR previous.after->>'access' IS DISTINCT FROM wanted_access
              OR (previous.before->>'version')::integer IS DISTINCT FROM expected THEN
              RAISE EXCEPTION 'operation_conflict' USING ERRCODE='GA003';
            END IF;
            RETURN previous.after;
          END IF;
          old := public.grove_admin_state(target);
          IF old IS NULL OR old->>'status' <> 'active' THEN
            RAISE EXCEPTION 'account_unavailable' USING ERRCODE='GA004';
          END IF;
          IF (old->>'version')::integer <> expected THEN
            RAISE EXCEPTION 'admin_version_conflict' USING ERRCODE='GA005';
          END IF;
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
      CREATE FUNCTION grove_admin_audit() RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE result jsonb;
        BEGIN
          PERFORM public.grove_admin_guard();
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'actorId',actor_id,
            'accountId',account_id,'kind',kind,'reason',reason,'before',before,'after',after,
            'createdAt',created_at) ORDER BY created_at DESC,id),'[]'::jsonb)
          INTO result FROM (SELECT * FROM public.system_admin_audit ORDER BY created_at DESC,id LIMIT 50) recent;
          RETURN result;
        END $$;
      CREATE FUNCTION grove_bootstrap_system_admin(subject text, explanation text) RETURNS uuid
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        DECLARE target uuid; old jsonb;
        BEGIN
          PERFORM pg_advisory_xact_lock(68142025);
          SELECT id INTO target FROM public.accounts WHERE clerk_subject=subject AND status='active';
          IF target IS NULL THEN RAISE EXCEPTION 'account_unavailable'; END IF;
          IF explanation IS NULL OR length(trim(explanation)) NOT BETWEEN 3 AND 300 THEN
            RAISE EXCEPTION 'invalid_request';
          END IF;
          IF EXISTS(SELECT 1 FROM public.account_administration WHERE account_id=target AND role='system_admin') THEN RETURN target; END IF;
          IF EXISTS(SELECT 1 FROM public.account_administration WHERE role='system_admin') THEN
            RAISE EXCEPTION 'already_bootstrapped';
          END IF;
          old := public.grove_admin_state(target);
          INSERT INTO public.account_administration(account_id,role,version) VALUES(target,'system_admin',1)
            ON CONFLICT(account_id) DO UPDATE SET role='system_admin',version=public.account_administration.version+1;
          INSERT INTO public.system_admin_audit(id,actor_id,account_id,kind,reason,before,after)
            VALUES(gen_random_uuid(),NULL,target,'bootstrap',explanation,old,public.grove_admin_state(target));
          RETURN target;
        END $$;
      REVOKE ALL ON FUNCTION grove_admin_state(uuid),grove_admin_guard(),grove_admin_accounts(text[]),
        grove_admin_change(uuid,uuid,integer,text,text,text),grove_admin_audit(),
        grove_bootstrap_system_admin(text,text) FROM PUBLIC,grove_runtime,grove_worker;
      GRANT EXECUTE ON FUNCTION grove_admin_accounts(text[]),grove_admin_change(uuid,uuid,integer,text,text,text),
        grove_admin_audit() TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
