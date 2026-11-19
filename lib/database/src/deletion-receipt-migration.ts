import type { Knex } from "knex";

export const deletionReceipt = {
  name: "20261119_047_deletion_receipt",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE deletion_receipts (
        id uuid PRIMARY KEY, account_id uuid NOT NULL UNIQUE REFERENCES accounts(id),
        snapshot bytea CHECK (octet_length(snapshot) BETWEEN 29 AND 512),
        created_at timestamptz NOT NULL DEFAULT now(), due_at timestamptz NOT NULL DEFAULT now(),
        attempts integer NOT NULL DEFAULT 0, lease_id uuid, lease_until timestamptz,
        dispatched_at timestamptz, dispatch_id uuid, dispatch_until timestamptz,
        fingerprint text, accepted_at timestamptz, provider_id text, failed_at timestamptz, error_code text,
        CHECK ((snapshot IS NULL) = (accepted_at IS NOT NULL OR failed_at IS NOT NULL))
      );
      CREATE INDEX deletion_receipts_due ON deletion_receipts(due_at) WHERE snapshot IS NOT NULL;
      ALTER TABLE deletion_receipts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY worker_tenant ON deletion_receipts TO grove_worker
        USING (account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      CREATE POLICY deletion_intent ON deletion_receipts FOR INSERT TO grove_runtime WITH CHECK (
        account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid AND EXISTS (
          SELECT 1 FROM accounts a WHERE a.id=account_id AND a.status='deleting' AND a.provider_deleted_at IS NULL));
      GRANT INSERT(id,account_id,snapshot) ON deletion_receipts TO grove_runtime;
      GRANT SELECT,UPDATE ON deletion_receipts TO grove_worker;

      CREATE FUNCTION grove_receipt_due(r deletion_receipts) RETURNS boolean LANGUAGE sql STABLE
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT r.snapshot IS NOT NULL AND r.attempts<5 AND r.created_at>now()-interval '23 hours'
          AND r.due_at<=now() AND (r.lease_until IS NULL OR r.lease_until<now())
          AND EXISTS (SELECT 1 FROM accounts a WHERE a.id=r.account_id AND a.status IN ('deleting','deleted'))
          AND NOT EXISTS (SELECT 1 FROM transactional_emails e WHERE e.account_id=r.account_id AND e.lease_until>now())
      $$;
      CREATE FUNCTION grove_dispatch_receipts() RETURNS TABLE(id uuid, dispatch_id uuid) LANGUAGE sql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        UPDATE deletion_receipts SET dispatch_id=gen_random_uuid(),dispatch_until=now()+interval '15 seconds' WHERE deletion_receipts.id IN (
          SELECT r.id FROM deletion_receipts r WHERE grove_receipt_due(r)
            AND (r.dispatch_until IS NULL OR r.dispatch_until<now())
            AND (r.dispatched_at IS NULL OR r.dispatched_at<now()-interval '15 seconds')
          ORDER BY r.due_at,r.id LIMIT 32 FOR UPDATE SKIP LOCKED) RETURNING deletion_receipts.id,deletion_receipts.dispatch_id
      $$;
      CREATE FUNCTION grove_mark_receipt_dispatched(wanted uuid, token uuid) RETURNS void LANGUAGE sql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        UPDATE deletion_receipts SET dispatched_at=now(),dispatch_id=NULL,dispatch_until=NULL
          WHERE id=wanted AND dispatch_id=token AND dispatch_until>now() AND snapshot IS NOT NULL
      $$;
      CREATE FUNCTION grove_claim_receipt(wanted uuid) RETURNS SETOF deletion_receipts LANGUAGE sql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        UPDATE deletion_receipts SET attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '120 seconds'
          WHERE id=(SELECT r.id FROM deletion_receipts r WHERE (wanted IS NULL OR r.id=wanted) AND grove_receipt_due(r)
            ORDER BY r.due_at,r.id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *
      $$;
      CREATE FUNCTION grove_sweep_receipts(paused boolean) RETURNS bigint LANGUAGE sql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
        WITH cleared AS (UPDATE deletion_receipts SET snapshot=NULL, fingerprint=NULL, lease_id=NULL,lease_until=NULL,
          failed_at=now(),error_code=CASE WHEN paused THEN 'receipt_paused' ELSE 'receipt_exhausted' END
          WHERE id IN (SELECT r.id FROM deletion_receipts r WHERE r.snapshot IS NOT NULL
            AND (paused OR r.created_at<=now()-interval '23 hours' OR (r.attempts>=5 AND r.lease_until<now()))
            ORDER BY r.created_at LIMIT 1000 FOR UPDATE SKIP LOCKED) RETURNING 1) SELECT count(*) FROM cleared
      $$;
      REVOKE ALL ON FUNCTION grove_receipt_due(deletion_receipts),grove_dispatch_receipts(),grove_mark_receipt_dispatched(uuid,uuid),grove_claim_receipt(uuid),grove_sweep_receipts(boolean) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_dispatch_receipts(),grove_mark_receipt_dispatched(uuid,uuid),grove_claim_receipt(uuid),grove_sweep_receipts(boolean) TO grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
