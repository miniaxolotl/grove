import type { Knex } from "knex";

export const notebookLifecycle = {
  name: "20261023_016_notebook_lifecycle",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE projects ADD COLUMN status text NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','archived')), ADD COLUMN archive_operation_id uuid;
      ALTER TABLE memories ADD COLUMN archive_operation_id uuid;
      DROP TRIGGER assistance_catalog_changed ON projects;
      CREATE TRIGGER assistance_catalog_changed AFTER INSERT OR DELETE OR UPDATE OF name,parent_id,status,deleted_at
        ON projects FOR EACH ROW EXECUTE FUNCTION grove_catalog_changed();

      -- Defense in depth for every writer, including imports, agents and workers.
      -- Soft deletion/cleanup remains allowed; no authored rows are removed.
      CREATE FUNCTION grove_notebook_writable() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
        IF TG_TABLE_NAME='memories' THEN
          IF (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects
              WHERE account_id=NEW.account_id AND id=NEW.project_id AND deleted_at IS NULL AND status='active'))
            OR (TG_OP='UPDATE' AND OLD.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM projects
              WHERE account_id=OLD.account_id AND id=OLD.project_id AND status='archived'))
            THEN RAISE EXCEPTION USING ERRCODE='GNB01',MESSAGE='notebook_inactive'; END IF;
        ELSE
          IF TG_OP='UPDATE' AND OLD.status='archived'
            AND (OLD.name IS DISTINCT FROM NEW.name OR OLD.parent_id IS DISTINCT FROM NEW.parent_id)
            THEN RAISE EXCEPTION USING ERRCODE='GNB01',MESSAGE='notebook_inactive'; END IF;
          IF NEW.parent_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.parent_id IS DISTINCT FROM NEW.parent_id)
            AND NOT EXISTS(SELECT 1 FROM projects WHERE account_id=NEW.account_id
              AND id=NEW.parent_id AND deleted_at IS NULL AND status='active')
            THEN RAISE EXCEPTION USING ERRCODE='GNB01',MESSAGE='notebook_inactive'; END IF;
        END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_notebook_writable() FROM PUBLIC;
      CREATE TRIGGER notebook_writable BEFORE INSERT OR UPDATE ON memories
        FOR EACH ROW EXECUTE FUNCTION grove_notebook_writable();
      CREATE TRIGGER notebook_writable BEFORE INSERT OR UPDATE ON projects
        FOR EACH ROW EXECUTE FUNCTION grove_notebook_writable();
    `);
    // The public reader bypasses tenant RLS and must filter archived notebooks too.
    const { rows } = await db.raw(
      "SELECT pg_get_functiondef('grove_public_share(text,text,uuid,uuid,uuid,integer,integer)'::regprocedure) AS definition",
    );
    await db.raw(
      rows[0].definition
        .replaceAll(
          "FROM projects WHERE",
          "FROM projects WHERE status='active' AND",
        )
        .replaceAll(
          "WHERE p.account_id = owner_id",
          "WHERE p.status='active' AND p.account_id = owner_id",
        )
        .replaceAll(
          "WHERE p.deleted_at IS NULL",
          "WHERE p.status='active' AND p.deleted_at IS NULL",
        ),
    );
  },
  async down() {
    throw new Error(
      "Use a forward migration; notebook lifecycle preserves retained data",
    );
  },
};
