import type { Knex } from "knex";

export const notebookOrder = {
  name: "20261025_032_notebook_order",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE projects ADD COLUMN position integer;
      WITH ranked AS (
        SELECT id, row_number() OVER (PARTITION BY account_id,parent_id ORDER BY name,id)::integer AS position
        FROM projects
      ) UPDATE projects p SET position=r.position FROM ranked r WHERE r.id=p.id;
      ALTER TABLE projects ALTER COLUMN position SET NOT NULL;
      CREATE INDEX projects_owner_order ON projects(account_id,status,parent_id,position,id) WHERE deleted_at IS NULL;
      ALTER TABLE accounts ADD COLUMN notebook_order_version bigint NOT NULL DEFAULT 0;
      CREATE FUNCTION grove_notebook_position() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF TG_OP='UPDATE' THEN
          IF OLD.status='archived' AND OLD.position IS DISTINCT FROM NEW.position
            AND NEW.deleted_at IS NULL THEN
            RAISE EXCEPTION USING ERRCODE='GNB01',MESSAGE='notebook_inactive';
          END IF;
        END IF;
        IF (TG_OP='INSERT' AND NEW.position IS NULL)
           OR (TG_OP='UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
          PERFORM id FROM accounts WHERE id=NEW.account_id FOR UPDATE;
          SELECT COALESCE(max(position),0)+1 INTO NEW.position FROM projects
            WHERE account_id=NEW.account_id AND parent_id IS NOT DISTINCT FROM NEW.parent_id
              AND id<>NEW.id AND deleted_at IS NULL;
        END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_notebook_position() FROM PUBLIC;
      CREATE TRIGGER notebook_position BEFORE INSERT OR UPDATE OF parent_id,position ON projects
        FOR EACH ROW EXECUTE FUNCTION grove_notebook_position();
      CREATE FUNCTION grove_notebook_order_changed() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF TG_OP='UPDATE' THEN
          IF (NEW.parent_id,NEW.position,NEW.name,NEW.version,NEW.status,NEW.deleted_at)
            IS NOT DISTINCT FROM (OLD.parent_id,OLD.position,OLD.name,OLD.version,OLD.status,OLD.deleted_at)
          THEN RETURN NULL; END IF;
        END IF;
        UPDATE accounts SET notebook_order_version=notebook_order_version+1
          WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.account_id ELSE NEW.account_id END;
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_notebook_order_changed() FROM PUBLIC;
      CREATE TRIGGER notebook_order_changed AFTER INSERT OR UPDATE OR DELETE ON projects
        FOR EACH ROW EXECUTE FUNCTION grove_notebook_order_changed();
    `);
  },
  async down() {
    throw new Error("Use a forward migration; preserve notebook order");
  },
};
