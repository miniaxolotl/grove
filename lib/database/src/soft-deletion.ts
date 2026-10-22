import type { Knex } from "knex";

/** Additive lifecycle change shared by normal mutations, cleanup and recovery. */
export async function softDeletion(db: Knex) {
  for (const table of [
    "memories",
    "projects",
    "conversations",
    "connections",
  ]) {
    await db.raw("ALTER TABLE ?? ADD COLUMN deleted_at timestamptz", [table]);
    await db.raw(
      "CREATE POLICY visible ON ?? AS RESTRICTIVE USING (deleted_at IS NULL) WITH CHECK (true)",
      [table],
    );
    await db.raw(
      "CREATE INDEX ?? ON ?? (account_id,id) WHERE deleted_at IS NULL",
      [`${table}_visible`, table],
    );
  }
  for (const [table, parent] of [
    ["memory_relationships", "memories"],
    ["notebook_relationships", "projects"],
  ]) {
    await db.raw(
      `CREATE POLICY visible_endpoints ON ?? AS RESTRICTIVE USING
      (EXISTS(SELECT 1 FROM ?? p WHERE p.account_id=??.account_id AND p.id=??.left_id AND p.deleted_at IS NULL)
      AND EXISTS(SELECT 1 FROM ?? p WHERE p.account_id=??.account_id AND p.id=??.right_id AND p.deleted_at IS NULL)) WITH CHECK(true)`,
      [table, parent, table, table, parent, table, table],
    );
  }
  await db.raw(`CREATE POLICY visible_target ON public_shares AS RESTRICTIVE USING
    ((memory_id IS NOT NULL AND EXISTS(SELECT 1 FROM memories m WHERE m.account_id=public_shares.account_id AND m.id=public_shares.memory_id AND m.deleted_at IS NULL))
    OR (project_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.account_id=public_shares.account_id AND p.id=public_shares.project_id AND p.deleted_at IS NULL))) WITH CHECK(true)`);
  await db.raw(`
    DROP INDEX memories_task;
    CREATE UNIQUE INDEX memories_task ON memories(account_id,COALESCE(project_id,'00000000-0000-4000-8000-000000000000'::uuid),task_id)
      WHERE task_id IS NOT NULL AND deleted_at IS NULL;
    ALTER TABLE projects DROP CONSTRAINT projects_account_id_identity_key;
    CREATE UNIQUE INDEX projects_account_id_identity_key ON projects(account_id,identity) WHERE deleted_at IS NULL;

    CREATE FUNCTION grove_soft_delete() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      IF TG_TABLE_NAME='memories' THEN
        UPDATE memories SET deleted_at=now(),status='archived' WHERE id=OLD.id AND deleted_at IS NULL;
      ELSIF TG_TABLE_NAME='connections' THEN
        UPDATE connections SET deleted_at=now(),revoked_at=COALESCE(revoked_at,now()) WHERE id=OLD.id AND deleted_at IS NULL;
      ELSE
        EXECUTE format('UPDATE public.%I SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL',TG_TABLE_NAME) USING OLD.id;
      END IF;
      RETURN NULL;
    END $$;
    REVOKE ALL ON FUNCTION grove_soft_delete() FROM PUBLIC;

    CREATE FUNCTION grove_deleted_content() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN RETURN NULL; END IF;
      IF TG_TABLE_NAME='memories' THEN
        INSERT INTO deleted_memories(account_id,id) VALUES(NEW.account_id,NEW.id) ON CONFLICT DO NOTHING;
        DELETE FROM public_share_rates WHERE bucket IN (SELECT id::text FROM public_shares WHERE account_id=NEW.account_id AND memory_id=NEW.id);
        DELETE FROM jobs WHERE account_id=NEW.account_id AND memory_id=NEW.id;
        DELETE FROM memory_embeddings WHERE account_id=NEW.account_id AND memory_id=NEW.id;
        DELETE FROM notebook_profiles WHERE account_id=NEW.account_id AND project_id=NEW.project_id;
        UPDATE notebook_relationships SET assessment=jsonb_build_object('relationship','unrelated','reason','','basis','none','direction','both','evidence','[]'::jsonb,'coverage',assessment->'coverage','breadth','thread'),profile='rebuild-after-deletion'
          WHERE account_id=NEW.account_id AND (left_id=NEW.project_id OR right_id=NEW.project_id
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(assessment->'evidence') e WHERE e->>'id'=NEW.id::text));
        UPDATE public_shares SET revoked_at=now(),token_digest=NULL,token_ciphertext=NULL,version=version+1
          WHERE account_id=NEW.account_id AND memory_id=NEW.id;
      ELSIF TG_TABLE_NAME='conversations' THEN
        INSERT INTO deleted_conversations(account_id,id) VALUES(NEW.account_id,NEW.id) ON CONFLICT DO NOTHING;
      ELSIF TG_TABLE_NAME='projects' THEN
        DELETE FROM public_share_rates WHERE bucket IN (SELECT id::text FROM public_shares WHERE account_id=NEW.account_id AND project_id=NEW.id);
        UPDATE public_shares SET revoked_at=now(),token_digest=NULL,token_ciphertext=NULL,version=version+1
          WHERE account_id=NEW.account_id AND project_id=NEW.id;
      END IF;
      RETURN NULL;
    END $$;
    REVOKE ALL ON FUNCTION grove_deleted_content() FROM PUBLIC;
  `);
  for (const table of [
    "memories",
    "projects",
    "conversations",
    "connections",
  ]) {
    await db.raw(
      `CREATE TRIGGER soft_delete BEFORE DELETE ON ?? FOR EACH ROW EXECUTE FUNCTION grove_soft_delete()`,
      [table],
    );
    await db.raw(
      `CREATE TRIGGER deleted_content AFTER UPDATE OF deleted_at ON ?? FOR EACH ROW EXECUTE FUNCTION grove_deleted_content()`,
      [table],
    );
  }
  for (const [table, parent, column] of [
    ["memory_revisions", "memories", "memory_id"],
    ["memory_embeddings", "memories", "memory_id"],
    ["memory_enrichments", "memories", "memory_id"],
    ["conversation_turns", "conversations", "conversation_id"],
    ["notebook_profiles", "projects", "project_id"],
  ]) {
    await db.raw(
      `CREATE POLICY visible_parent ON ?? AS RESTRICTIVE USING
      (EXISTS(SELECT 1 FROM ?? parent WHERE parent.account_id=??.account_id AND parent.id=??.?? AND parent.deleted_at IS NULL)) WITH CHECK(true)`,
      [table, parent, table, table, column],
    );
  }
  // The public reader runs with narrowly elevated privileges, so it must filter
  // tombstones explicitly as well as checking account/share status.
  const { rows } = await db.raw(
    "SELECT pg_get_functiondef('grove_public_share(text,text,uuid,uuid,uuid,integer,integer)'::regprocedure) AS definition",
  );
  await db.raw(
    rows[0].definition
      .replaceAll(
        "FROM projects WHERE account_id = owner_id",
        "FROM projects WHERE deleted_at IS NULL AND account_id = owner_id",
      )
      .replaceAll(
        "WHERE p.account_id = owner_id",
        "WHERE p.deleted_at IS NULL AND p.account_id = owner_id",
      )
      .replaceAll(
        "AND status = 'active' AND (expires_at",
        "AND deleted_at IS NULL AND status = 'active' AND (expires_at",
      )
      .replaceAll(
        "AND m.status = 'active' AND (m.expires_at",
        "AND m.deleted_at IS NULL AND m.status = 'active' AND (m.expires_at",
      ),
  );

  await db.raw(`
    CREATE OR REPLACE FUNCTION grove_webhook(event_id text,event_type text,subject text,event_at bigint) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
    BEGIN
      INSERT INTO webhook_receipts(id) VALUES(event_id) ON CONFLICT DO NOTHING;
      IF NOT FOUND THEN RETURN; END IF;
      IF event_type IN ('session.revoked','session.ended','session.removed') THEN
        INSERT INTO session_revocations(id) VALUES(subject) ON CONFLICT DO NOTHING;
        RETURN;
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(subject,1));
      IF event_type='user.deleted' THEN
        INSERT INTO subject_authority(subject,event_at,deleted) VALUES(subject,event_at,true)
          ON CONFLICT ON CONSTRAINT subject_authority_pkey DO UPDATE SET deleted=true;
        UPDATE accounts SET status='deleting',deleted_at=now(),provider_deleted_at=now()
          WHERE clerk_subject=subject AND status<>'deleted';
      ELSIF event_type IN ('user.created','user.updated') THEN
        INSERT INTO subject_authority(subject,event_at,deleted) VALUES(subject,event_at,false)
          ON CONFLICT ON CONSTRAINT subject_authority_pkey DO UPDATE SET event_at=EXCLUDED.event_at
          WHERE subject_authority.event_at<EXCLUDED.event_at AND NOT subject_authority.deleted;
      END IF;
    END $$;

    CREATE FUNCTION grove_schedule_cleanup() RETURNS integer LANGUAGE plpgsql
      SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    DECLARE added integer;
    BEGIN
      WITH due AS (
        SELECT a.id,CASE WHEN a.status='deleting' THEN 'account_cleanup' ELSE 'retention_cleanup' END AS kind
        FROM accounts a WHERE a.status='deleting' OR (a.status='active' AND (
          EXISTS(SELECT 1 FROM memories m WHERE m.account_id=a.id AND m.deleted_at IS NULL AND m.purge_at<=now())
          OR EXISTS(SELECT 1 FROM rate_buckets r WHERE r.account_id=a.id AND r.minute<now()-interval '1 day')))
        ORDER BY a.work_claimed_at NULLS FIRST,a.id LIMIT 20
      ), inserted AS (
        INSERT INTO background_tasks(account_id,kind,dedupe_key)
          SELECT id,kind,'lifecycle' FROM due
        ON CONFLICT(account_id,kind,dedupe_key) DO UPDATE SET status='pending',due_at=now(),updated_at=now(),
          finished_at=NULL,cursor='{}',processed=0,failures=0,error_code=NULL,dispatched_at=NULL,dispatch_id=NULL,dispatch_until=NULL
          WHERE background_tasks.status='succeeded'
        RETURNING 1
      ) SELECT count(*) INTO added FROM inserted;
      RETURN added;
    END $$;
    REVOKE ALL ON FUNCTION grove_schedule_cleanup() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION grove_schedule_cleanup() TO grove_worker;

    CREATE FUNCTION grove_account_cleanup_requested() RETURNS trigger LANGUAGE plpgsql
      SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
    BEGIN
      IF NEW.status='deleting' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO background_tasks(account_id,kind,dedupe_key) VALUES(NEW.id,'account_cleanup','lifecycle')
          ON CONFLICT(account_id,kind,dedupe_key) DO NOTHING;
        UPDATE background_tasks SET status='cancelled',lease_id=NULL,lease_until=NULL,updated_at=now(),finished_at=now()
          WHERE account_id=NEW.id AND kind NOT IN ('account_cleanup','artifact_cleanup') AND status IN ('pending','running');
      END IF;
      RETURN NULL;
    END $$;
    REVOKE ALL ON FUNCTION grove_account_cleanup_requested() FROM PUBLIC;
    CREATE TRIGGER account_cleanup_requested AFTER UPDATE OF status ON accounts
      FOR EACH ROW EXECUTE FUNCTION grove_account_cleanup_requested();
  `);
}
