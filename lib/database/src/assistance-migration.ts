import type { Knex } from "knex";

export const notebookAssistance = {
  name: "20261022_015_notebook_assistance",
  async up(db: Knex) {
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
