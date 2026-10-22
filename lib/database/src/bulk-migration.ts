import type { Knex } from "knex";

export async function bulkWork(db: Knex) {
  await db.raw(`
    ALTER TABLE accounts ADD COLUMN export_version bigint NOT NULL DEFAULT 0;
    ALTER TABLE background_tasks ADD CONSTRAINT background_tasks_owner_id UNIQUE(account_id,id);
    CREATE TABLE export_objects (
      object_key text PRIMARY KEY,account_id uuid NOT NULL,task_id uuid NOT NULL,part integer,
      bytes bigint NOT NULL DEFAULT 0,expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
      FOREIGN KEY(account_id,task_id) REFERENCES background_tasks(account_id,id)
    );
    CREATE UNIQUE INDEX export_objects_parts ON export_objects(task_id,part) WHERE part IS NOT NULL;
    CREATE INDEX export_objects_expiry ON export_objects(expires_at,account_id);
    CREATE TABLE import_sources (
      account_id uuid NOT NULL,source text NOT NULL,external_id text NOT NULL,
      memory_id uuid NOT NULL,version integer NOT NULL,fingerprint text NOT NULL,
      PRIMARY KEY(account_id,source,external_id),
      FOREIGN KEY(account_id,memory_id) REFERENCES memories(account_id,id)
    );
    CREATE TABLE connector_checkpoints (
      account_id uuid NOT NULL REFERENCES accounts(id),source text NOT NULL,cursor jsonb NOT NULL DEFAULT '{}',
      PRIMARY KEY(account_id,source)
    );
    CREATE FUNCTION grove_export_version() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    BEGIN
      UPDATE accounts SET export_version=export_version+1 WHERE id=COALESCE(NEW.account_id,OLD.account_id);
      RETURN NULL;
    END $$;
    REVOKE ALL ON FUNCTION grove_export_version() FROM PUBLIC;
  `);
  for (const table of [
    "export_objects",
    "import_sources",
    "connector_checkpoints",
  ]) {
    await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
    await db.raw(
      "CREATE POLICY tenant ON ?? USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid) WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)",
      [table],
    );
    await db.raw(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON ?? TO grove_runtime,grove_worker",
      [table],
    );
  }
  for (const table of [
    "memories",
    "projects",
    "conversations",
    "conversation_turns",
    "memory_relationships",
    "notebook_relationships",
  ]) {
    await db.raw(
      "CREATE TRIGGER export_version AFTER INSERT OR UPDATE OR DELETE ON ?? FOR EACH ROW EXECUTE FUNCTION grove_export_version()",
      [table],
    );
  }
  await db.raw(`
    CREATE FUNCTION grove_schedule_artifacts() RETURNS integer LANGUAGE plpgsql
      SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    DECLARE added integer;
    BEGIN
      WITH inserted AS (INSERT INTO background_tasks(account_id,kind,dedupe_key)
        SELECT DISTINCT account_id,'artifact_cleanup','artifacts' FROM export_objects WHERE expires_at<=now() LIMIT 20
        ON CONFLICT(account_id,kind,dedupe_key) DO UPDATE SET status='pending',failures=0,error_code=NULL,
          due_at=now(),finished_at=NULL,updated_at=now(),dispatched_at=NULL,dispatch_id=NULL,dispatch_until=NULL
          WHERE background_tasks.status='succeeded' RETURNING 1)
        SELECT count(*) INTO added FROM inserted;
      RETURN added;
    END $$;
    REVOKE ALL ON FUNCTION grove_schedule_artifacts() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION grove_schedule_artifacts() TO grove_worker;
  `);
}
