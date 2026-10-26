import type { Knex } from "knex";

export const documentImports = {
  name: "20261025_031_document_imports",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE background_tasks DROP CONSTRAINT background_tasks_kind_check;
      ALTER TABLE background_tasks ADD CONSTRAINT background_tasks_kind_check CHECK(kind IN
        ('export','account_cleanup','retention_cleanup','artifact_cleanup','model_backfill','import','connector_sync','speech_transcribe','speech_synthesize','document_prepare','document_import'));
      CREATE TABLE document_import_batches (
        account_id uuid NOT NULL REFERENCES accounts(id), id uuid NOT NULL,
        version integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'uploading'
          CHECK(status IN ('uploading','preparing','ready','applying','complete','cancelled')),
        task_id uuid, confirm_id uuid, confirm_hash text, suggestion_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
        suggestion_request_id uuid, suggestion_hash text, suggestion_lease uuid, suggestion_until timestamptz,
        expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
        drafts_cleared boolean NOT NULL DEFAULT false,
        PRIMARY KEY(account_id,id), FOREIGN KEY(account_id,task_id) REFERENCES background_tasks(account_id,id)
      );
      CREATE TABLE document_import_files (
        account_id uuid NOT NULL, batch_id uuid NOT NULL, id uuid NOT NULL,
        filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
        bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 3145728), sha256 text NOT NULL,
        staging bytea CHECK(octet_length(staging)<=3145728), mime text,
        status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
        error text, pages integer, empty_pages jsonb NOT NULL DEFAULT '[]',
        object_key text, original_ready boolean NOT NULL DEFAULT false,
        PRIMARY KEY(account_id,batch_id,id), UNIQUE(account_id,id),
        FOREIGN KEY(account_id,batch_id) REFERENCES document_import_batches(account_id,id)
      );
      CREATE TABLE document_import_notes (
        account_id uuid NOT NULL, batch_id uuid NOT NULL, id uuid NOT NULL,
        file_id uuid NOT NULL, ordinal integer NOT NULL, content text NOT NULL CHECK(length(content) BETWEEN 1 AND 6000),
        included boolean NOT NULL DEFAULT true, destination jsonb NOT NULL DEFAULT 'null', suggestion text,
        page_start integer NOT NULL, page_end integer NOT NULL, source_start integer NOT NULL, source_end integer NOT NULL,
        memory_id uuid, PRIMARY KEY(account_id,batch_id,id), UNIQUE(account_id,batch_id,file_id,ordinal),
        FOREIGN KEY(account_id,batch_id,file_id) REFERENCES document_import_files(account_id,batch_id,id),
        FOREIGN KEY(account_id,memory_id) REFERENCES memories(account_id,id)
      );
      CREATE INDEX document_import_expiry ON document_import_batches(account_id,expires_at);
      CREATE INDEX document_import_note_page ON document_import_notes(account_id,batch_id,id);
      CREATE INDEX document_import_sources ON document_import_notes(account_id,memory_id) WHERE memory_id IS NOT NULL;
      CREATE TABLE document_import_attempts (
        account_id uuid NOT NULL, batch_id uuid NOT NULL, file_id uuid NOT NULL, id uuid NOT NULL,
        object_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id,id), FOREIGN KEY(account_id,batch_id,file_id) REFERENCES document_import_files(account_id,batch_id,id)
      );
    `);
    for (const table of [
      "document_import_batches",
      "document_import_files",
      "document_import_notes",
      "document_import_attempts",
    ]) {
      await db.raw(
        `ALTER TABLE ?? ENABLE ROW LEVEL SECURITY; ALTER TABLE ?? FORCE ROW LEVEL SECURITY`,
        [table, table],
      );
      await db.raw(
        `CREATE POLICY tenant ON ?? USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid) WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw(
        `CREATE POLICY active_owner ON ?? AS RESTRICTIVE USING(EXISTS(SELECT 1 FROM accounts a WHERE a.id=??.account_id AND a.status='active')) WITH CHECK(true)`,
        [table, table],
      );
      await db.raw(
        `GRANT SELECT,INSERT,UPDATE ON ?? TO grove_runtime,grove_worker`,
        [table],
      );
    }
    await db.raw(`
      REVOKE UPDATE ON document_import_attempts FROM grove_runtime,grove_worker;
      CREATE FUNCTION grove_immutable_import_source() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF OLD.original_ready AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'document_source_immutable'; END IF;
        IF (NEW.account_id,NEW.batch_id,NEW.id,NEW.filename,NEW.bytes,NEW.sha256) IS DISTINCT FROM
           (OLD.account_id,OLD.batch_id,OLD.id,OLD.filename,OLD.bytes,OLD.sha256) THEN RAISE EXCEPTION 'document_identity_immutable'; END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_immutable_import_source() FROM PUBLIC;
      CREATE TRIGGER immutable_import_source BEFORE UPDATE ON document_import_files
        FOR EACH ROW EXECUTE FUNCTION grove_immutable_import_source();
      CREATE FUNCTION grove_cancel_import_drafts() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        UPDATE document_import_files SET staging=NULL WHERE account_id=NEW.account_id AND batch_id=NEW.id AND NOT original_ready;
        UPDATE document_import_notes SET content='[Import draft unavailable]',included=false,suggestion=NULL WHERE account_id=NEW.account_id AND batch_id=NEW.id AND memory_id IS NULL;
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_cancel_import_drafts() FROM PUBLIC;
      CREATE TRIGGER cancel_import_drafts AFTER UPDATE OF status ON document_import_batches
        FOR EACH ROW WHEN (NEW.status='cancelled' AND OLD.status<>'cancelled') EXECUTE FUNCTION grove_cancel_import_drafts();
      CREATE FUNCTION grove_end_import_drafts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
        SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE previous_scope text;
      BEGIN
        previous_scope:=current_setting('grove.account_id',true);
        PERFORM set_config('grove.account_id',OLD.id::text,true);
        UPDATE document_import_files SET staging=NULL WHERE account_id=OLD.id AND NOT original_ready;
        UPDATE document_import_notes SET content='[Import draft unavailable]',included=false,suggestion=NULL WHERE account_id=OLD.id AND memory_id IS NULL;
        UPDATE document_import_batches SET status='cancelled',version=version+1 WHERE account_id=OLD.id AND status NOT IN ('complete','cancelled');
        PERFORM set_config('grove.account_id',coalesce(previous_scope,''),true);
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_end_import_drafts() FROM PUBLIC;
      CREATE TRIGGER end_import_drafts BEFORE UPDATE OF status ON accounts
        FOR EACH ROW WHEN (OLD.status='active' AND NEW.status<>'active') EXECUTE FUNCTION grove_end_import_drafts();
      CREATE FUNCTION grove_fence_import_suggestions() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        UPDATE document_import_batches SET version=version+1,suggestion_id=NULL
          WHERE account_id=NEW.id AND status='ready';
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_fence_import_suggestions() FROM PUBLIC;
      CREATE TRIGGER fence_import_suggestions AFTER UPDATE OF filing_enabled ON accounts
        FOR EACH ROW WHEN (NEW.filing_enabled IS DISTINCT FROM OLD.filing_enabled) EXECUTE FUNCTION grove_fence_import_suggestions();
      CREATE OR REPLACE FUNCTION grove_schedule_cleanup() RETURNS integer LANGUAGE plpgsql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE added integer;
      BEGIN
        WITH due AS (
          SELECT a.id,CASE WHEN a.status='deleting' THEN 'account_cleanup' ELSE 'retention_cleanup' END AS kind
          FROM accounts a WHERE a.status='deleting' OR (a.status='active' AND (
            EXISTS(SELECT 1 FROM memories m WHERE m.account_id=a.id AND m.deleted_at IS NULL AND m.purge_at<=now())
            OR EXISTS(SELECT 1 FROM rate_buckets r WHERE r.account_id=a.id AND r.minute<now()-interval '1 day')
            OR EXISTS(SELECT 1 FROM document_import_batches b WHERE b.account_id=a.id AND NOT b.drafts_cleared
              AND b.expires_at<=now() AND b.status IN ('uploading','preparing','ready','cancelled'))))
          ORDER BY a.work_claimed_at NULLS FIRST,a.id LIMIT 20
        ), inserted AS (
          INSERT INTO background_tasks(account_id,kind,dedupe_key) SELECT id,kind,'lifecycle' FROM due
          ON CONFLICT(account_id,kind,dedupe_key) DO UPDATE SET status='pending',due_at=now(),updated_at=now(),
            finished_at=NULL,cursor='{}',processed=0,failures=0,error_code=NULL,dispatched_at=NULL,dispatch_id=NULL,dispatch_until=NULL
            WHERE background_tasks.status='succeeded' RETURNING 1
        ) SELECT count(*) INTO added FROM inserted;
        RETURN added;
      END $$;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
