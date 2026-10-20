import type { Knex } from "knex";

export const backgroundServices = {
  name: "20261020_007_background_services",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN organization_due_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE accounts ADD COLUMN organization_checked_at timestamptz;
      ALTER TABLE jobs ADD COLUMN dispatched_at timestamptz;
      CREATE TABLE transactional_emails (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id),
        event_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('welcome','connection_approved','connection_revoked')),
        created_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0, lease_id uuid, lease_until timestamptz,
        dispatched_at timestamptz, sent_at timestamptz, provider_id text, failed_at timestamptz, error_code text,
        UNIQUE(account_id, event_key)
      );
      ALTER TABLE transactional_emails ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON transactional_emails USING (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid)
        WITH CHECK (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid);
      GRANT SELECT, INSERT, UPDATE, DELETE ON transactional_emails TO grove_worker;
      CREATE INDEX transactional_emails_due ON transactional_emails(due_at) WHERE sent_at IS NULL AND failed_at IS NULL;

      CREATE FUNCTION grove_queue_transactional_email() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      DECLARE event_kind text; owner_id uuid; event_identity text;
      BEGIN
        IF TG_TABLE_NAME = 'accounts' THEN
          owner_id := NEW.id; event_kind := 'welcome'; event_identity := 'welcome';
        ELSE
          owner_id := NEW.account_id;
          IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = owner_id AND status = 'active') THEN RETURN NEW; END IF;
          IF TG_OP = 'INSERT' THEN
            IF cardinality(NEW.capabilities) = 0 OR NEW.revoked_at IS NOT NULL THEN RETURN NEW; END IF;
            event_kind := 'connection_approved';
          ELSIF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
            IF cardinality(OLD.capabilities) = 0 THEN RETURN NEW; END IF;
            event_kind := 'connection_revoked';
          ELSIF cardinality(NEW.capabilities) > 0 AND NEW.revoked_at IS NULL AND (cardinality(OLD.capabilities) = 0 OR OLD.revoked_at IS NOT NULL) THEN
            event_kind := 'connection_approved';
          ELSE RETURN NEW;
          END IF;
          event_identity := event_kind || ':' || NEW.id::text || ':' || txid_current()::text;
        END IF;
        INSERT INTO transactional_emails(account_id, event_key, kind) VALUES(owner_id, event_identity, event_kind)
          ON CONFLICT(account_id, event_key) DO NOTHING;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_queue_transactional_email() FROM PUBLIC;
      CREATE TRIGGER account_welcome AFTER INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION grove_queue_transactional_email();
      CREATE TRIGGER connection_notification AFTER INSERT OR UPDATE ON connections FOR EACH ROW EXECUTE FUNCTION grove_queue_transactional_email();

      DROP FUNCTION grove_claim_job(text[]);
      CREATE FUNCTION grove_claim_job(profiles text[] DEFAULT NULL, wanted uuid DEFAULT NULL) RETURNS SETOF jobs
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE jobs SET failed_at = now(), error_code = 'lease_exhausted'
          WHERE failed_at IS NULL AND attempts >= 5 AND (lease_until IS NULL OR lease_until < now());
        RETURN QUERY UPDATE jobs SET lease_id = gen_random_uuid(), lease_until = now() + interval '120 seconds', attempts = attempts + 1
          WHERE id = (SELECT j.id FROM jobs j JOIN accounts a ON a.id = j.account_id
            WHERE a.status = 'active' AND j.failed_at IS NULL AND j.attempts < 5 AND j.due_at <= now()
            AND (wanted IS NULL OR j.id = wanted) AND (profiles IS NULL OR j.profile = ANY(profiles))
            AND (j.kind <> 'decision' OR NOT EXISTS (SELECT 1 FROM jobs e WHERE e.account_id = j.account_id AND e.target = j.target AND e.kind = 'embedding' AND e.failed_at IS NULL AND (profiles IS NULL OR e.profile = ANY(profiles))))
            AND (j.kind <> 'brief' OR NOT EXISTS (SELECT 1 FROM jobs e WHERE e.account_id = j.account_id AND e.kind <> 'brief' AND e.failed_at IS NULL AND (profiles IS NULL OR e.profile = ANY(profiles))))
            AND (j.lease_until IS NULL OR j.lease_until < now()) ORDER BY j.due_at, j.id
            FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING *;
      END $$;
      REVOKE ALL ON FUNCTION grove_claim_job(text[],uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_claim_job(text[],uuid) TO grove_worker;

      CREATE FUNCTION grove_claim_email(wanted uuid DEFAULT NULL) RETURNS SETOF transactional_emails
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE transactional_emails SET failed_at = now(), error_code = 'delivery_exhausted'
          WHERE sent_at IS NULL AND failed_at IS NULL AND (attempts >= 5 OR created_at < now() - interval '23 hours')
          AND (lease_until IS NULL OR lease_until < now());
        RETURN QUERY UPDATE transactional_emails SET lease_id = gen_random_uuid(), lease_until = now() + interval '120 seconds', attempts = attempts + 1
          WHERE id = (SELECT e.id FROM transactional_emails e JOIN accounts a ON a.id = e.account_id
            WHERE a.status = 'active' AND e.sent_at IS NULL AND e.failed_at IS NULL AND e.due_at <= now()
            AND (wanted IS NULL OR e.id = wanted) AND (e.lease_until IS NULL OR e.lease_until < now())
            ORDER BY e.due_at, e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1) RETURNING *;
      END $$;
      REVOKE ALL ON FUNCTION grove_claim_email(uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_claim_email(uuid) TO grove_worker;

      CREATE FUNCTION grove_due_dispatch(profiles text[], mail_enabled boolean) RETURNS TABLE(id uuid, account_id uuid, queue_kind text)
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT due.id, due.account_id, due.queue_kind FROM (
          SELECT j.id, j.account_id, 'memory'::text AS queue_kind, j.due_at FROM jobs j JOIN accounts a ON a.id = j.account_id
          WHERE a.status = 'active' AND j.profile = ANY(profiles) AND j.failed_at IS NULL AND j.attempts < 5
            AND j.due_at <= now() AND (j.lease_until IS NULL OR j.lease_until < now())
            AND (j.dispatched_at IS NULL OR j.dispatched_at < now() - interval '60 seconds')
          UNION ALL
          SELECT e.id, e.account_id, 'email'::text AS queue_kind, e.due_at FROM transactional_emails e JOIN accounts a ON a.id = e.account_id
          WHERE mail_enabled AND a.status = 'active' AND e.sent_at IS NULL AND e.failed_at IS NULL AND e.attempts < 5
            AND e.created_at > now() - interval '23 hours' AND e.due_at <= now() AND (e.lease_until IS NULL OR e.lease_until < now())
            AND (e.dispatched_at IS NULL OR e.dispatched_at < now() - interval '60 seconds')
        ) due ORDER BY due.due_at, due.id LIMIT 100;
      $$;
      REVOKE ALL ON FUNCTION grove_due_dispatch(text[],boolean) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_due_dispatch(text[],boolean) TO grove_worker;

      CREATE FUNCTION grove_organization_accounts(interval_seconds integer) RETURNS TABLE(id uuid)
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        UPDATE accounts SET organization_due_at = now() + (greatest(60, least(interval_seconds, 86400)) * interval '1 second'), organization_checked_at = now()
        WHERE accounts.id IN (SELECT a.id FROM accounts a WHERE a.status = 'active' AND a.organization_due_at <= now()
          ORDER BY a.organization_due_at, a.id FOR UPDATE SKIP LOCKED LIMIT 20) RETURNING accounts.id;
      $$;
      REVOKE ALL ON FUNCTION grove_organization_accounts(integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_organization_accounts(integer) TO grove_worker;

      CREATE FUNCTION grove_sweep_deliveries() RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE jobs SET failed_at = now(), error_code = 'lease_exhausted'
          WHERE failed_at IS NULL AND attempts >= 5 AND (lease_until IS NULL OR lease_until < now());
        UPDATE transactional_emails SET failed_at = now(), error_code = 'delivery_exhausted'
          WHERE sent_at IS NULL AND failed_at IS NULL AND (attempts >= 5 OR created_at < now() - interval '23 hours')
          AND (lease_until IS NULL OR lease_until < now());
      END $$;
      REVOKE ALL ON FUNCTION grove_sweep_deliveries() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_sweep_deliveries() TO grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
