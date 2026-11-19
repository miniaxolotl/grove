import type { Knex } from "knex";

export const lifecycleReconciliation = {
  name: "20261119_048_lifecycle_reconciliation",
  async up(db: Knex) {
    await db.raw(`
      -- No admission row is installed by migration or runtime. The separately
      -- approved operator must bind the new immutable source and phase receipt.
      CREATE TABLE lifecycle_release_control (
        singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        release_hash text NOT NULL CHECK(release_hash ~ '^[a-f0-9]{64}$'),
        receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),
        generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
        phase text NOT NULL DEFAULT 'reconcile' CHECK(phase IN ('reconcile','handoff','released')),
        approval_hash text CHECK(approval_hash ~ '^[a-f0-9]{64}$'), approved_generation bigint,
        approved_at timestamptz, handoff_evidence jsonb,
        CHECK((approval_hash IS NULL)=(approved_generation IS NULL))
      );
      CREATE TABLE lifecycle_events (
        provider text NOT NULL CHECK(provider IN ('clerk','stripe')),
        event_id text NOT NULL CHECK(length(event_id) BETWEEN 1 AND 255),
        fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
        event_type text NOT NULL CHECK(length(event_type) BETWEEN 1 AND 100),
        event_at bigint NOT NULL CHECK(event_at>0),
        received_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(provider,event_id)
      );
      -- Only versions and scoped IDs are staged; no customer body, address,
      -- subscription metadata or credential is copied into the inbox/outbox.
      CREATE TABLE lifecycle_billing_state (
        account_id uuid PRIMARY KEY REFERENCES accounts(id),
        generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
        reconciled_generation bigint NOT NULL DEFAULT 0 CHECK(reconciled_generation>=0),
        remote_hash text CHECK(remote_hash ~ '^[a-f0-9]{64}$'), observed_at timestamptz,
        customer_hash text CHECK(customer_hash ~ '^[a-f0-9]{64}$'), authority_status text
      );
      ALTER TABLE lifecycle_events ENABLE ROW LEVEL SECURITY;
      ALTER TABLE lifecycle_billing_state ENABLE ROW LEVEL SECURITY;
      ALTER TABLE lifecycle_release_control ENABLE ROW LEVEL SECURITY;
      CREATE TABLE lifecycle_billing_effects (
        account_id uuid NOT NULL REFERENCES accounts(id),
        operation text NOT NULL CHECK(operation IN ('cancel','expire')),
        remote_id text NOT NULL CHECK(remote_id ~ '^[a-zA-Z0-9_-]{1,255}$'),
        state text NOT NULL DEFAULT 'uncertain' CHECK(state IN ('uncertain','confirmed')),
        created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz,
        PRIMARY KEY(account_id,operation,remote_id)
      );
      ALTER TABLE lifecycle_billing_effects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE background_tasks DROP CONSTRAINT background_tasks_kind_check;
      ALTER TABLE background_tasks ADD CONSTRAINT background_tasks_kind_check CHECK(kind IN
        ('export','account_cleanup','retention_cleanup','artifact_cleanup','model_backfill','import','connector_sync',
         'document_prepare','document_import','conversation_document','speech_transcribe','speech_synthesize','sentence_rewrite','billing_reconcile'));

      -- Keep this kind out of the ordinary task runner. A dedicated *mode* on
      -- the existing worker/queue stack owns its narrow fenced claim path.
      ALTER FUNCTION grove_task_allowed(background_tasks) RENAME TO grove_task_allowed_before_lifecycle;
      CREATE FUNCTION grove_task_allowed(t background_tasks) RETURNS boolean LANGUAGE sql STABLE
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT t.kind<>'billing_reconcile' AND grove_task_allowed_before_lifecycle(t)
      $$;
      REVOKE ALL ON FUNCTION grove_task_allowed(background_tasks) FROM PUBLIC;

      CREATE FUNCTION grove_lifecycle_accept(release_key text, receipt_key text, provider_name text,
        event_key text, body_fingerprint text, event_kind text, subject_key text, occurred_at bigint, disabled_value boolean)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE control lifecycle_release_control; prior lifecycle_events; owner_id uuid; version bigint;
        previous_scope text; old_authority subject_authority;
      BEGIN
        SELECT * INTO control FROM lifecycle_release_control WHERE singleton FOR UPDATE;
        IF NOT FOUND OR control.release_hash<>release_key OR control.receipt_hash<>receipt_key THEN
          RAISE EXCEPTION 'lifecycle release fence';
        END IF;
        IF provider_name NOT IN ('clerk','stripe') OR body_fingerprint !~ '^[a-f0-9]{64}$'
          OR length(event_key) NOT BETWEEN 1 AND 255 OR length(subject_key) NOT BETWEEN 1 AND 255
          OR occurred_at<=0 OR occurred_at>extract(epoch FROM clock_timestamp())*1000+300000
          OR disabled_value IS NULL THEN RAISE EXCEPTION 'invalid lifecycle command'; END IF;
        SELECT * INTO prior FROM lifecycle_events WHERE provider=provider_name AND event_id=event_key;
        IF FOUND THEN
          IF prior.fingerprint<>body_fingerprint OR prior.event_type<>event_kind OR prior.event_at<>occurred_at THEN
            RAISE EXCEPTION 'lifecycle replay conflict';
          END IF;
          RETURN false;
        END IF;
        IF provider_name='clerk' THEN
          IF event_kind NOT IN ('user.created','user.updated','user.deleted','session.revoked','session.ended','session.removed') THEN
            RAISE EXCEPTION 'invalid lifecycle command'; END IF;
          -- Serialize with ordinary identity authorization and preserve deletion
          -- forever; at an equal timestamp disabled wins over reactivation.
          PERFORM pg_advisory_xact_lock(hashtextextended(subject_key,1));
          SELECT * INTO old_authority FROM subject_authority WHERE subject=subject_key;
          PERFORM grove_webhook(event_key,event_kind,subject_key,occurred_at);
          IF event_kind IN ('user.created','user.updated') AND (old_authority.subject IS NULL
            OR old_authority.event_at<occurred_at OR (old_authority.event_at=occurred_at AND disabled_value)) THEN
            PERFORM grove_user_state(subject_key,occurred_at,disabled_value);
          END IF;
          IF event_kind LIKE 'user.%' THEN SELECT id INTO owner_id FROM accounts WHERE clerk_subject=subject_key FOR UPDATE; END IF;
        ELSE
          IF event_kind !~ '^(customer\\.subscription\\.(created|updated|deleted)|checkout\\.session\\.(completed|async_payment_succeeded|async_payment_failed)|invoice\\.(paid|payment_failed))$'
            THEN RAISE EXCEPTION 'invalid lifecycle command'; END IF;
          SELECT a.id INTO owner_id FROM accounts a JOIN billing_customers c ON c.account_id=a.id
            WHERE c.customer_id=subject_key FOR UPDATE OF a;
          IF NOT FOUND THEN RAISE EXCEPTION 'unknown billing tenant'; END IF;
        END IF;
        IF owner_id IS NOT NULL AND EXISTS(SELECT 1 FROM billing_customers WHERE account_id=owner_id AND customer_id IS NOT NULL) THEN
          INSERT INTO lifecycle_billing_state(account_id,generation) VALUES(owner_id,1)
            ON CONFLICT(account_id) DO UPDATE SET generation=lifecycle_billing_state.generation+1 RETURNING generation INTO version;
          previous_scope:=current_setting('grove.account_id',true);
          PERFORM set_config('grove.account_id',owner_id::text,true);
          INSERT INTO background_tasks(account_id,kind,dedupe_key,payload)
            VALUES(owner_id,'billing_reconcile','lifecycle:'||version::text,jsonb_build_object('generation',version));
          PERFORM set_config('grove.account_id',coalesce(previous_scope,''),true);
        END IF;
        INSERT INTO lifecycle_events(provider,event_id,fingerprint,event_type,event_at)
          VALUES(provider_name,event_key,body_fingerprint,event_kind,occurred_at);
        UPDATE lifecycle_release_control SET generation=generation+1,
          phase=CASE WHEN phase='handoff' THEN 'reconcile' ELSE phase END,
          approval_hash=CASE WHEN phase='handoff' THEN NULL ELSE approval_hash END,
          approved_generation=CASE WHEN phase='handoff' THEN NULL ELSE approved_generation END,
          approved_at=CASE WHEN phase='handoff' THEN NULL ELSE approved_at END,
          handoff_evidence=CASE WHEN phase='handoff' THEN NULL ELSE handoff_evidence END WHERE singleton;
        RETURN true;
      END $$;
      REVOKE ALL ON FUNCTION grove_lifecycle_accept(text,text,text,text,text,text,text,bigint,boolean) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_accept(text,text,text,text,text,text,text,bigint,boolean) TO grove_runtime;

      CREATE FUNCTION grove_lifecycle_valid(release_key text, receipt_key text, wanted uuid, token uuid, expected_status text)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT EXISTS(SELECT 1 FROM lifecycle_release_control c,background_tasks t
          JOIN accounts a ON a.id=t.account_id JOIN lifecycle_billing_state s ON s.account_id=a.id
          WHERE c.singleton AND c.release_hash=release_key AND c.receipt_hash=receipt_key AND c.phase IN ('reconcile','released')
            AND t.id=wanted AND t.kind='billing_reconcile' AND t.status='running' AND t.lease_id=token AND t.lease_until>clock_timestamp()
            AND t.created_at>clock_timestamp()-interval '23 hours' AND s.generation=(t.payload->>'generation')::bigint
            AND a.status=expected_status AND (expected_status<>'active' OR (a.deleted_at IS NULL AND NOT EXISTS
              (SELECT 1 FROM subject_authority sa WHERE sa.subject=a.clerk_subject AND (sa.deleted OR sa.disabled))))
            AND EXISTS(SELECT 1 FROM billing_customers b WHERE b.account_id=a.id AND b.customer_id IS NOT NULL
              AND t.cursor->>'customerHash'=encode(sha256(convert_to(b.customer_id,'UTF8')),'hex')))
      $$;
      CREATE FUNCTION grove_lifecycle_claim(release_key text, receipt_key text, wanted uuid DEFAULT NULL)
        RETURNS TABLE(task_id uuid,account_id uuid,lease_id uuid,generation bigint,customer_id text,account_status text)
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE control lifecycle_release_control; selected background_tasks; owner_status text;
      BEGIN
        SELECT * INTO control FROM lifecycle_release_control WHERE singleton FOR UPDATE;
        IF NOT FOUND OR control.release_hash<>release_key OR control.receipt_hash<>receipt_key THEN RAISE EXCEPTION 'lifecycle release fence'; END IF;
        IF control.phase NOT IN ('reconcile','released') THEN RETURN; END IF;
        UPDATE background_tasks SET status='failed',error_code='lifecycle_exhausted',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
          lease_id=NULL,lease_until=NULL,dispatch_id=NULL,dispatch_until=NULL WHERE id IN(
            SELECT t.id FROM background_tasks t WHERE t.kind='billing_reconcile' AND t.status IN ('pending','running')
              AND (t.attempts>=5 OR t.created_at<=clock_timestamp()-interval '23 hours')
              AND (t.lease_until IS NULL OR t.lease_until<clock_timestamp()) ORDER BY t.created_at LIMIT 1000 FOR UPDATE SKIP LOCKED);
        IF (SELECT count(*) FROM background_tasks WHERE kind='billing_reconcile' AND lease_until>clock_timestamp())>=8 THEN RETURN; END IF;
        SELECT t.* INTO selected FROM background_tasks t JOIN lifecycle_billing_state s ON s.account_id=t.account_id
          WHERE t.kind='billing_reconcile' AND (wanted IS NULL OR t.id=wanted) AND t.status IN ('pending','running')
            AND t.attempts<5 AND t.created_at>clock_timestamp()-interval '23 hours' AND t.due_at<=clock_timestamp()
            AND (t.lease_until IS NULL OR t.lease_until<clock_timestamp()) AND s.generation=(t.payload->>'generation')::bigint
            AND NOT EXISTS(SELECT 1 FROM background_tasks busy WHERE busy.account_id=t.account_id AND busy.kind='billing_reconcile' AND busy.lease_until>clock_timestamp())
          ORDER BY t.due_at,t.id LIMIT 1;
        IF NOT FOUND THEN RETURN; END IF;
        SELECT status INTO owner_status FROM accounts WHERE id=selected.account_id FOR UPDATE;
        -- Match ingress lock order: control -> account -> task. No lock or SQL
        -- transaction survives the claim, preflight or provider I/O boundary.
        PERFORM 1 FROM background_tasks t WHERE t.id=selected.id AND t.status IN ('pending','running')
          AND (t.lease_until IS NULL OR t.lease_until<clock_timestamp()) FOR UPDATE;
        IF NOT FOUND THEN RETURN; END IF;
        RETURN QUERY WITH leased AS (
          UPDATE background_tasks SET status='running',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',
            attempts=attempts+1,claimed_at=clock_timestamp(),updated_at=clock_timestamp(),
            cursor=jsonb_build_object('customerHash',(SELECT encode(sha256(convert_to(bc.customer_id,'UTF8')),'hex') FROM billing_customers bc WHERE bc.account_id=selected.account_id))
            WHERE id=selected.id RETURNING *
        ) SELECT l.id,l.account_id,l.lease_id,(l.payload->>'generation')::bigint,b.customer_id,owner_status
          FROM leased l JOIN billing_customers b ON b.account_id=l.account_id WHERE b.customer_id IS NOT NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_lifecycle_valid(text,text,uuid,uuid,text),grove_lifecycle_claim(text,text,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_valid(text,text,uuid,uuid,text),grove_lifecycle_claim(text,text,uuid) TO grove_worker;

      CREATE FUNCTION grove_lifecycle_complete(release_key text, receipt_key text, wanted uuid, token uuid, expected_status text, subscriptions jsonb, remote_fingerprint text, open_sessions integer)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE selected background_tasks; previous_scope text;
      BEGIN
        PERFORM 1 FROM lifecycle_release_control WHERE singleton FOR UPDATE;
        SELECT * INTO selected FROM background_tasks WHERE id=wanted;
        IF NOT FOUND THEN RETURN false; END IF;
        PERFORM 1 FROM accounts WHERE id=selected.account_id FOR UPDATE;
        PERFORM 1 FROM background_tasks WHERE id=wanted FOR UPDATE;
        IF NOT grove_lifecycle_valid(release_key,receipt_key,wanted,token,expected_status) THEN RETURN false; END IF;
        IF remote_fingerprint !~ '^[a-f0-9]{64}$'
          OR jsonb_typeof(subscriptions)<>'array' OR jsonb_array_length(subscriptions)>1000 THEN RETURN false; END IF;
        IF expected_status IN ('deleting','deleted') AND (open_sessions<>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(subscriptions) e
          WHERE e->>'status' NOT IN ('canceled','incomplete_expired'))) THEN RETURN false; END IF;
        IF EXISTS(SELECT 1 FROM lifecycle_billing_effects WHERE account_id=selected.account_id AND state='uncertain') THEN RETURN false; END IF;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(subscriptions) e WHERE e->>'customer' IS DISTINCT FROM
          (SELECT customer_id FROM billing_customers WHERE account_id=selected.account_id)) THEN RETURN false; END IF;
        previous_scope:=current_setting('grove.account_id',true);
        PERFORM set_config('grove.account_id',selected.account_id::text,true);
        DELETE FROM billing_subscriptions WHERE account_id=selected.account_id;
        IF expected_status='active' THEN
          INSERT INTO billing_subscriptions(id,account_id,customer_id,price_id,product_id,status,period_end,cancel_at_period_end)
            SELECT e->>'id',selected.account_id,e->>'customer',e->>'price',e->>'product',e->>'status',
              to_timestamp((e->>'periodEnd')::double precision),(e->>'cancelAtPeriodEnd')::boolean FROM jsonb_array_elements(subscriptions) e;
        END IF;
        UPDATE lifecycle_billing_state SET reconciled_generation=generation,remote_hash=remote_fingerprint,observed_at=clock_timestamp(),
          customer_hash=selected.cursor->>'customerHash',authority_status=expected_status WHERE account_id=selected.account_id;
        UPDATE background_tasks SET status='succeeded',finished_at=clock_timestamp(),updated_at=clock_timestamp(),lease_id=NULL,lease_until=NULL,
          result=jsonb_build_object('generation',payload->'generation','remoteHash',remote_fingerprint),error_code=NULL WHERE id=wanted;
        UPDATE background_tasks SET status='cancelled',finished_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE account_id=selected.account_id AND kind='billing_reconcile'
          AND status IN ('pending','running') AND (payload->>'generation')::bigint<(selected.payload->>'generation')::bigint;
        PERFORM set_config('grove.account_id',coalesce(previous_scope,''),true);
        RETURN true;
      END $$;
      CREATE FUNCTION grove_lifecycle_failure(release_key text, receipt_key text, wanted uuid, token uuid)
        RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        UPDATE background_tasks t SET status=CASE WHEN attempts>=5 OR created_at<=clock_timestamp()-interval '23 hours' THEN 'failed' ELSE 'pending' END,
          error_code='lifecycle_reconciliation_failed',lease_id=NULL,lease_until=NULL,dispatch_id=NULL,dispatch_until=NULL,dispatched_at=NULL,
          due_at=clock_timestamp()+least(3600,5*power(2,attempts)) * interval '1 second',updated_at=clock_timestamp()
          WHERE t.id=wanted AND t.kind='billing_reconcile' AND t.lease_id=token AND t.lease_until>clock_timestamp()
            AND EXISTS(SELECT 1 FROM lifecycle_release_control WHERE singleton AND release_hash=release_key AND receipt_hash=receipt_key)
      $$;
      REVOKE ALL ON FUNCTION grove_lifecycle_complete(text,text,uuid,uuid,text,jsonb,text,integer),grove_lifecycle_failure(text,text,uuid,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_complete(text,text,uuid,uuid,text,jsonb,text,integer),grove_lifecycle_failure(text,text,uuid,uuid) TO grove_worker;

      CREATE FUNCTION grove_lifecycle_effects(release_key text,receipt_key text,wanted uuid,token uuid,expected_status text)
        RETURNS TABLE(operation text,remote_id text,state text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT e.operation,e.remote_id,e.state FROM lifecycle_billing_effects e JOIN background_tasks t ON t.account_id=e.account_id
          WHERE t.id=wanted AND grove_lifecycle_valid(release_key,receipt_key,wanted,token,expected_status)
      $$;
      CREATE FUNCTION grove_lifecycle_effect(release_key text,receipt_key text,wanted uuid,token uuid,expected_status text,effect_kind text,target text,confirmed boolean)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE selected background_tasks;
      BEGIN
        PERFORM 1 FROM lifecycle_release_control WHERE singleton FOR UPDATE;
        SELECT * INTO selected FROM background_tasks WHERE id=wanted;
        IF NOT FOUND THEN RETURN false; END IF;
        PERFORM 1 FROM accounts WHERE id=selected.account_id FOR UPDATE;
        PERFORM 1 FROM background_tasks WHERE id=wanted FOR UPDATE;
        IF NOT grove_lifecycle_valid(release_key,receipt_key,wanted,token,expected_status)
          OR expected_status NOT IN ('deleting','deleted') OR effect_kind NOT IN ('cancel','expire')
          OR target !~ '^[a-zA-Z0-9_-]{1,255}$' THEN RETURN false; END IF;
        IF confirmed THEN
          UPDATE lifecycle_billing_effects SET state='confirmed',confirmed_at=clock_timestamp()
            WHERE account_id=selected.account_id AND operation=effect_kind AND remote_id=target;
          RETURN FOUND;
        END IF;
        -- This marker commits BEFORE the remote call. A crash at either side of
        -- the boundary demands read-only reconciliation, not a second cancel.
        INSERT INTO lifecycle_billing_effects(account_id,operation,remote_id) VALUES(selected.account_id,effect_kind,target) ON CONFLICT DO NOTHING;
        RETURN FOUND;
      END $$;
      REVOKE ALL ON FUNCTION grove_lifecycle_effects(text,text,uuid,uuid,text),grove_lifecycle_effect(text,text,uuid,uuid,text,text,text,boolean) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_effects(text,text,uuid,uuid,text),grove_lifecycle_effect(text,text,uuid,uuid,text,text,text,boolean) TO grove_worker;

      CREATE FUNCTION grove_lifecycle_status(release_key text,receipt_key text) RETURNS jsonb LANGUAGE sql STABLE
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        WITH control AS (SELECT * FROM lifecycle_release_control WHERE singleton AND release_hash=release_key AND receipt_hash=receipt_key),
        customers AS (SELECT b.account_id,s.generation,s.reconciled_generation,s.remote_hash,s.observed_at,
          s.customer_hash=encode(sha256(convert_to(b.customer_id,'UTF8')),'hex') AND s.authority_status=a.status
          AND (a.status<>'active' OR (a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM subject_authority sa WHERE sa.subject=a.clerk_subject AND (sa.deleted OR sa.disabled)))) AS scoped
          FROM billing_customers b JOIN accounts a ON a.id=b.account_id
          LEFT JOIN lifecycle_billing_state s ON s.account_id=b.account_id WHERE b.customer_id IS NOT NULL),
        counts AS (SELECT count(*) AS customers,count(*) FILTER(WHERE generation=reconciled_generation AND remote_hash IS NOT NULL
          AND scoped AND observed_at>clock_timestamp()-interval '10 minutes') AS verified FROM customers),
        pending AS (SELECT count(*) AS count FROM background_tasks t JOIN lifecycle_billing_state s ON s.account_id=t.account_id
          WHERE t.kind='billing_reconcile' AND t.status<>'succeeded' AND (t.payload->>'generation')::bigint=s.generation),
        uncertain AS (SELECT count(*) AS count FROM lifecycle_billing_effects WHERE state='uncertain')
        SELECT jsonb_build_object('release',release_hash,'receipt',receipt_hash,'generation',control.generation::text,
          'customers',counts.customers,'remoteVerified',counts.verified,'pending',pending.count,'uncertain',uncertain.count,
          'caughtUp',counts.customers=counts.verified AND pending.count=0 AND uncertain.count=0,
          'authorityHash',encode(sha256(convert_to(jsonb_build_object(
            'accounts',(SELECT coalesce(jsonb_agg(jsonb_build_array(id,status,deleted_at,provider_deleted_at) ORDER BY id),'[]') FROM accounts),
            'subjects',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY subject),'[]') FROM subject_authority s),
            'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM session_revocations r),
            'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY provider,event_id),'[]') FROM lifecycle_events e))::text,'UTF8')),'hex'),
          'remoteHash',encode(sha256(convert_to((SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY account_id),'[]') FROM lifecycle_billing_state s)::text,'UTF8')),'hex'))
        FROM control,counts,pending,uncertain
      $$;
      CREATE FUNCTION grove_lifecycle_handoff(release_key text,receipt_key text,expected_generation bigint,approval_key text)
        RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE control lifecycle_release_control; evidence jsonb;
      BEGIN
        SELECT * INTO control FROM lifecycle_release_control WHERE singleton FOR UPDATE;
        IF NOT FOUND OR control.release_hash<>release_key OR control.receipt_hash<>receipt_key
          OR control.generation<>expected_generation THEN RAISE EXCEPTION 'lifecycle generation fence'; END IF;
        IF approval_key !~ '^[a-f0-9]{64}$' OR control.phase<>'reconcile' THEN RAISE EXCEPTION 'lifecycle approval fence'; END IF;
        evidence:=grove_lifecycle_status(release_key,receipt_key);
        IF evidence->>'caughtUp' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'lifecycle not reconciled'; END IF;
        UPDATE lifecycle_release_control SET phase='handoff',approval_hash=approval_key,approved_generation=generation,
          approved_at=clock_timestamp(),handoff_evidence=evidence WHERE singleton;
        RETURN evidence;
      END $$;
      CREATE FUNCTION grove_lifecycle_release(release_key text,receipt_key text,approval_key text)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE control lifecycle_release_control; evidence jsonb;
      BEGIN
        SELECT * INTO control FROM lifecycle_release_control WHERE singleton FOR UPDATE;
        IF NOT FOUND OR control.release_hash<>release_key OR control.receipt_hash<>receipt_key
          OR control.approval_hash IS DISTINCT FROM approval_key THEN RETURN false; END IF;
        IF control.phase='released' THEN RETURN true; END IF;
        IF control.phase<>'handoff' OR control.approved_generation IS DISTINCT FROM control.generation
          OR control.approved_at<clock_timestamp()-interval '10 minutes' OR control.approved_at IS NULL THEN RETURN false; END IF;
        evidence:=grove_lifecycle_status(release_key,receipt_key);
        IF evidence IS DISTINCT FROM control.handoff_evidence OR evidence->>'caughtUp' IS DISTINCT FROM 'true' THEN RETURN false; END IF;
        -- This commit is the release linearization point, before runtime import.
        -- Events before it invalidate handoff; events after it use ordinary
        -- authority/deletion fences and the same durable reconciliation path.
        UPDATE lifecycle_release_control SET phase='released' WHERE singleton;
        RETURN true;
      END $$;
      REVOKE ALL ON FUNCTION grove_lifecycle_status(text,text),grove_lifecycle_handoff(text,text,bigint,text),grove_lifecycle_release(text,text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_status(text,text),grove_lifecycle_release(text,text,text) TO grove_runtime,grove_worker;
      -- handoff intentionally remains migration/operator-owner only.

      CREATE FUNCTION grove_lifecycle_bound(release_key text,receipt_key text) RETURNS boolean LANGUAGE sql STABLE
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT EXISTS(SELECT 1 FROM lifecycle_release_control WHERE singleton AND release_hash=release_key AND receipt_hash=receipt_key)
      $$;
      CREATE FUNCTION grove_lifecycle_release_approved(release_key text,approval_key text) RETURNS boolean LANGUAGE plpgsql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE receipt_key text;
      BEGIN
        SELECT receipt_hash INTO receipt_key FROM lifecycle_release_control WHERE singleton AND release_hash=release_key AND approval_hash=approval_key FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        RETURN grove_lifecycle_release(release_key,receipt_key,approval_key);
      END $$;
      CREATE FUNCTION grove_lifecycle_dispatch(release_key text,receipt_key text) RETURNS TABLE(id uuid,dispatch_id uuid)
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM lifecycle_release_control WHERE singleton AND release_hash=release_key
          AND receipt_hash=receipt_key AND phase IN ('reconcile','released')) THEN RETURN; END IF;
        RETURN QUERY UPDATE background_tasks t SET dispatch_id=gen_random_uuid(),dispatch_until=clock_timestamp()+interval '30 seconds'
          WHERE t.id IN(SELECT q.id FROM background_tasks q JOIN lifecycle_billing_state s ON s.account_id=q.account_id
            WHERE q.kind='billing_reconcile' AND q.status IN ('pending','running') AND q.attempts<5
              AND (q.payload->>'generation')::bigint=s.generation AND q.due_at<=clock_timestamp()
              AND q.created_at>clock_timestamp()-interval '23 hours' AND (q.lease_until IS NULL OR q.lease_until<clock_timestamp())
              AND (q.dispatch_until IS NULL OR q.dispatch_until<clock_timestamp())
              AND (q.dispatched_at IS NULL OR q.dispatched_at<clock_timestamp()-interval '15 seconds')
            ORDER BY q.due_at,q.id LIMIT 32 FOR UPDATE OF q SKIP LOCKED) RETURNING t.id,t.dispatch_id;
      END $$;
      REVOKE ALL ON FUNCTION grove_lifecycle_bound(text,text),grove_lifecycle_release_approved(text,text),grove_lifecycle_dispatch(text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_bound(text,text),grove_lifecycle_release_approved(text,text) TO grove_runtime,grove_worker;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_dispatch(text,text) TO grove_worker;

      CREATE FUNCTION grove_lifecycle_enroll(release_key text,receipt_key text) RETURNS integer
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE control lifecycle_release_control; owner_id uuid; queued integer:=0; previous_scope text;
      BEGIN
        SELECT * INTO control FROM lifecycle_release_control WHERE singleton FOR UPDATE;
        IF NOT FOUND OR control.release_hash<>release_key OR control.receipt_hash<>receipt_key THEN RAISE EXCEPTION 'lifecycle release fence'; END IF;
        IF control.phase NOT IN ('reconcile','released') THEN RETURN 0; END IF;
        previous_scope:=current_setting('grove.account_id',true);
        -- Restored mappings are discovered in bounded worker batches, not by
        -- remote I/O or a bulk import inside an HTTP request/operator transaction.
        FOR owner_id IN SELECT b.account_id FROM billing_customers b JOIN accounts a ON a.id=b.account_id
          WHERE b.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lifecycle_billing_state s WHERE s.account_id=b.account_id)
          ORDER BY b.account_id LIMIT 32 FOR UPDATE OF a
        LOOP
          INSERT INTO lifecycle_billing_state(account_id,generation) VALUES(owner_id,1);
          PERFORM set_config('grove.account_id',owner_id::text,true);
          INSERT INTO background_tasks(account_id,kind,dedupe_key,payload) VALUES(owner_id,'billing_reconcile','lifecycle:1','{"generation":1}');
          queued:=queued+1;
        END LOOP;
        PERFORM set_config('grove.account_id',coalesce(previous_scope,''),true);
        IF queued>0 THEN UPDATE lifecycle_release_control SET generation=generation+1 WHERE singleton; END IF;
        RETURN queued;
      END $$;
      REVOKE ALL ON FUNCTION grove_lifecycle_enroll(text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_lifecycle_enroll(text,text) TO grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
