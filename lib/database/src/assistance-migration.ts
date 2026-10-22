import type { Knex } from "knex";

export const notebookAssistance = {
  name: "20261022_015_notebook_assistance",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN filing_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN action_lists_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN digests_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN cleanup_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN change_token bigint NOT NULL DEFAULT 0,
        ADD COLUMN notebook_catalog_version integer NOT NULL DEFAULT 0;
      UPDATE accounts SET filing_enabled=titles_tags_enabled, action_lists_enabled=ask_enabled,
        digests_enabled=notebook_summaries_enabled, cleanup_enabled=note_connections_enabled;
      CREATE TABLE assistance_requests (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, id uuid NOT NULL,
        kind text NOT NULL CHECK(kind IN('filing','actions','digest','cleanup')),
        input jsonb NOT NULL, fingerprint text NOT NULL, profile text NOT NULL,
        status text NOT NULL DEFAULT 'pending', version integer NOT NULL DEFAULT 1,
        state jsonb NOT NULL DEFAULT '{}', dependencies jsonb NOT NULL DEFAULT '[]',
        scopes jsonb NOT NULL DEFAULT '[]', result jsonb, error text,
        applied jsonb NOT NULL DEFAULT '[]', undo jsonb, application text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id,id)
      );
      CREATE TABLE assistance_reviews (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        key text NOT NULL, version integer NOT NULL DEFAULT 0, dismissed boolean NOT NULL,
        PRIMARY KEY(account_id,key)
      );
      CREATE TABLE notebook_changes (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, token bigint NOT NULL,
        memory_id uuid NOT NULL, old_project_id uuid, new_project_id uuid,
        before_version integer, after_version integer, kind text NOT NULL,
        at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(account_id,token)
      );
      CREATE INDEX notebook_changes_old ON notebook_changes(account_id,old_project_id,token);
      CREATE INDEX notebook_changes_new ON notebook_changes(account_id,new_project_id,token);
      CREATE TABLE notebook_checkpoints (
        account_id uuid NOT NULL, project_id uuid NOT NULL, token bigint NOT NULL,
        PRIMARY KEY(account_id,project_id),
        FOREIGN KEY(account_id,project_id) REFERENCES projects(account_id,id) ON DELETE CASCADE
      );
      CREATE TABLE notebook_visits (
        account_id uuid NOT NULL, id uuid NOT NULL, project_id uuid NOT NULL,
        from_token bigint NOT NULL, to_token bigint NOT NULL, baseline boolean NOT NULL,
        at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(account_id,id),
        FOREIGN KEY(account_id,project_id) REFERENCES projects(account_id,id) ON DELETE CASCADE
      );
      CREATE TABLE notebook_expiries (
        account_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL,
        project_id uuid NOT NULL, due_at timestamptz NOT NULL,
        PRIMARY KEY(account_id,memory_id),
        FOREIGN KEY(account_id,memory_id) REFERENCES memories(account_id,id) ON DELETE CASCADE
      );
      INSERT INTO notebook_expiries(account_id,memory_id,version,project_id,due_at)
        SELECT account_id,id,version,project_id,expires_at FROM memories
        WHERE project_id IS NOT NULL AND expires_at>now() AND deleted_at IS NULL;
      ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
      ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN
        ('embedding','decision','organization','brief','relationship_scan','note_relationship','notebook_profile','notebook_relationship','assistance'));
      ALTER TABLE jobs DROP CONSTRAINT job_target;
      ALTER TABLE jobs ADD CONSTRAINT job_target CHECK (
        (kind IN ('brief','note_relationship','notebook_profile','notebook_relationship','assistance') AND memory_id IS NULL AND version IS NULL AND scope IS NOT NULL)
        OR (kind IN ('embedding','decision','organization','relationship_scan') AND memory_id IS NOT NULL AND version IS NOT NULL));
    `);
    for (const table of [
      "assistance_requests",
      "assistance_reviews",
      "notebook_changes",
      "notebook_checkpoints",
      "notebook_visits",
      "notebook_expiries",
    ]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      await db.raw("ALTER TABLE ?? FORCE ROW LEVEL SECURITY", [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING
        (account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON ?? TO grove_runtime,grove_worker",
        [table],
      );
    }
    await db.raw(`
      CREATE FUNCTION grove_record_note_change() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE aid uuid; stamp bigint; action text;
      BEGIN
        aid:=COALESCE(NEW.account_id,OLD.account_id);
        IF TG_OP='INSERT' THEN action:='created';
        ELSIF TG_OP='DELETE' THEN action:='deleted';
        ELSIF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN action:=CASE WHEN NEW.deleted_at IS NULL THEN 'restored' ELSE 'deleted' END;
        ELSIF OLD.project_id IS DISTINCT FROM NEW.project_id THEN action:='moved';
        ELSIF OLD.status IS DISTINCT FROM NEW.status THEN action:=CASE WHEN NEW.status='archived' THEN 'archived' ELSE 'restored' END;
        ELSIF OLD.content IS DISTINCT FROM NEW.content THEN action:='edited';
        ELSIF OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN action:='retention';
        ELSE RETURN NULL; END IF;
        UPDATE accounts SET change_token=change_token+1 WHERE id=aid RETURNING change_token INTO stamp;
        INSERT INTO notebook_changes(account_id,token,memory_id,old_project_id,new_project_id,before_version,after_version,kind)
          VALUES(aid,stamp,COALESCE(NEW.id,OLD.id),OLD.project_id,NEW.project_id,OLD.version,NEW.version,action);
        DELETE FROM notebook_expiries WHERE account_id=aid AND memory_id=COALESCE(NEW.id,OLD.id);
        IF TG_OP<>'DELETE' AND NEW.project_id IS NOT NULL AND NEW.expires_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
          INSERT INTO notebook_expiries(account_id,memory_id,version,project_id,due_at)
            VALUES(aid,NEW.id,NEW.version,NEW.project_id,NEW.expires_at);
        END IF;
        IF action='deleted' THEN
          UPDATE assistance_requests SET result=NULL,state='{}',
            undo=CASE WHEN applied @> jsonb_build_array(jsonb_build_object('id',COALESCE(NEW.id,OLD.id))) THEN NULL ELSE undo END,
            status=CASE WHEN status IN ('applied','undone') AND NOT applied @> jsonb_build_array(jsonb_build_object('id',COALESCE(NEW.id,OLD.id))) THEN status ELSE 'stale' END,
            error='Source removed'
            WHERE account_id=aid AND (dependencies @> jsonb_build_array(jsonb_build_object('id',COALESCE(NEW.id,OLD.id)))
              OR scopes @> jsonb_build_array(jsonb_build_object('id',OLD.project_id)));
        END IF;
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_record_note_change() FROM PUBLIC;
      CREATE TRIGGER assistance_note_changed AFTER INSERT OR DELETE OR UPDATE OF content,project_id,status,expires_at,deleted_at
        ON memories FOR EACH ROW EXECUTE FUNCTION grove_record_note_change();
      CREATE FUNCTION grove_catalog_changed() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        UPDATE accounts SET notebook_catalog_version=notebook_catalog_version+1 WHERE id=COALESCE(NEW.account_id,OLD.account_id);
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_catalog_changed() FROM PUBLIC;
      CREATE TRIGGER assistance_catalog_changed AFTER INSERT OR DELETE OR UPDATE OF name,parent_id,deleted_at
        ON projects FOR EACH ROW EXECUTE FUNCTION grove_catalog_changed();
    `);
    await db.raw(`
      ALTER TABLE memory_briefs ADD COLUMN notebook_version integer,
        ADD COLUMN coverage jsonb, ADD COLUMN expires_at timestamptz;
      CREATE TABLE notebook_summary_nodes (
        account_id uuid NOT NULL, project_id uuid NOT NULL, profile text NOT NULL,
        path text NOT NULL, fingerprint text NOT NULL, content jsonb NOT NULL,
        evidence jsonb NOT NULL, examined integer NOT NULL,
        PRIMARY KEY(account_id,project_id,profile,path),
        FOREIGN KEY(account_id,project_id) REFERENCES projects(account_id,id) ON DELETE CASCADE
      );
      CREATE TABLE notebook_summary_work (
        account_id uuid NOT NULL, project_id uuid NOT NULL, profile text NOT NULL,
        content_version integer NOT NULL, stack jsonb NOT NULL, expires_at timestamptz,
        PRIMARY KEY(account_id,project_id,profile),
        FOREIGN KEY(account_id,project_id) REFERENCES projects(account_id,id) ON DELETE CASCADE
      );
    `);
    for (const table of ["notebook_summary_nodes", "notebook_summary_work"]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      await db.raw("ALTER TABLE ?? FORCE ROW LEVEL SECURITY", [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING
        (account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw(
        `CREATE POLICY visible_parent ON ?? AS RESTRICTIVE USING
        (EXISTS(SELECT 1 FROM projects p WHERE p.account_id=??.account_id AND p.id=??.project_id AND p.deleted_at IS NULL))`,
        [table, table, table],
      );
      await db.raw(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON ?? TO grove_runtime,grove_worker",
        [table],
      );
    }
    await db.raw(`
      CREATE FUNCTION grove_summary_changed() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE old_project uuid; new_project uuid;
      BEGIN
        IF TG_OP<>'INSERT' THEN old_project:=OLD.project_id; END IF;
        IF TG_OP<>'DELETE' THEN new_project:=NEW.project_id; END IF;
        INSERT INTO jobs(account_id,kind,target,profile,scope,due_at)
          SELECT account_id,'brief',target,profile,scope,now()+interval '5 seconds'
          FROM memory_briefs WHERE account_id=COALESCE(NEW.account_id,OLD.account_id)
            AND scope->>'taskId' IS NULL
            AND (scope->>'projectId')::uuid IN (old_project,new_project)
          ON CONFLICT(account_id,kind,target,profile) DO UPDATE SET attempts=0,failed_at=NULL,
            error_code=NULL,lease_id=NULL,lease_until=NULL,due_at=EXCLUDED.due_at;
        IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND NEW.deleted_at IS NOT NULL) THEN
          DELETE FROM notebook_summary_nodes WHERE account_id=OLD.account_id
            AND project_id IN(old_project,new_project);
          DELETE FROM memory_briefs WHERE account_id=OLD.account_id
            AND (scope->>'projectId')::uuid IN(old_project,new_project);
        END IF;
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_summary_changed() FROM PUBLIC;
      CREATE TRIGGER summary_changed AFTER INSERT OR DELETE OR UPDATE OF content,version,project_id,status,expires_at,deleted_at
        ON memories FOR EACH ROW EXECUTE FUNCTION grove_summary_changed();
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
