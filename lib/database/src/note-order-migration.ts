import type { Knex } from "knex";

export const noteOrder = {
  name: "20261126_049_note_order",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN note_order_version bigint NOT NULL DEFAULT 0;
      CREATE TABLE note_order_positions (
        account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        scope text NOT NULL CHECK (scope IN ('all','unfiled') OR scope ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'),
        memory_id uuid NOT NULL,
        rank numeric NOT NULL CHECK (rank NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
        PRIMARY KEY(account_id,scope,memory_id),
        FOREIGN KEY(account_id,memory_id) REFERENCES memories(account_id,id) ON DELETE CASCADE
      );
      CREATE INDEX note_order_neighbors ON note_order_positions(account_id,scope,rank,memory_id);
      ALTER TABLE note_order_positions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE note_order_positions FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON note_order_positions
        USING (account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK (account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE,DELETE ON note_order_positions TO grove_runtime,grove_worker;
      CREATE FUNCTION grove_note_default_rank(mid uuid, created timestamptz) RETURNS numeric
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
        SELECT trunc(extract(epoch FROM created)*1000000)*340282366920938463463374607431768211456
          + ('x'||substr(replace(mid::text,'-',''),1,8))::bit(32)::bigint::numeric*79228162514264337593543950336
          + ('x'||substr(replace(mid::text,'-',''),9,8))::bit(32)::bigint::numeric*18446744073709551616
          + ('x'||substr(replace(mid::text,'-',''),17,8))::bit(32)::bigint::numeric*4294967296
          + ('x'||substr(replace(mid::text,'-',''),25,8))::bit(32)::bigint::numeric
      $$;
      REVOKE ALL ON FUNCTION grove_note_default_rank(uuid,timestamptz) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_note_default_rank(uuid,timestamptz) TO grove_runtime,grove_worker;
      CREATE INDEX memories_default_order ON memories(account_id,grove_note_default_rank(id,created_at)) WHERE deleted_at IS NULL;
      CREATE INDEX memories_container_default_order ON memories(account_id,project_id,grove_note_default_rank(id,created_at)) WHERE deleted_at IS NULL;
      CREATE FUNCTION grove_note_order_append() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE container text; scopes text[]; base numeric; tail numeric; default_tail numeric;
      BEGIN
        IF TG_OP='UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NULL; END IF;
        PERFORM id FROM accounts WHERE id=NEW.account_id FOR UPDATE;
        base:=grove_note_default_rank(NEW.id,NEW.created_at);
        IF TG_OP='UPDATE' THEN
          DELETE FROM note_order_positions WHERE account_id=NEW.account_id AND memory_id=NEW.id AND scope<>'all';
          scopes:=ARRAY[COALESCE(NEW.project_id::text,'unfiled')];
        ELSE scopes:=ARRAY['all',COALESCE(NEW.project_id::text,'unfiled')]; END IF;
        FOREACH container IN ARRAY scopes LOOP
          SELECT rank INTO tail FROM note_order_positions
            WHERE account_id=NEW.account_id AND scope=container AND memory_id<>NEW.id
            ORDER BY rank DESC,memory_id DESC LIMIT 1;
          -- A generic OR-across-scopes plan scans/sorts the whole account.
          -- Explicit predicates let every scope seek its existing tail index.
          IF container='all' THEN
            SELECT grove_note_default_rank(id,created_at) INTO default_tail FROM memories
              WHERE account_id=NEW.account_id AND id<>NEW.id AND deleted_at IS NULL
              ORDER BY grove_note_default_rank(id,created_at) DESC LIMIT 1;
          ELSIF container='unfiled' THEN
            SELECT grove_note_default_rank(id,created_at) INTO default_tail FROM memories
              WHERE account_id=NEW.account_id AND id<>NEW.id AND deleted_at IS NULL AND project_id IS NULL
              ORDER BY grove_note_default_rank(id,created_at) DESC LIMIT 1;
          ELSE
            SELECT grove_note_default_rank(id,created_at) INTO default_tail FROM memories
              WHERE account_id=NEW.account_id AND id<>NEW.id AND deleted_at IS NULL AND project_id=container::uuid
              ORDER BY grove_note_default_rank(id,created_at) DESC LIMIT 1;
          END IF;
          tail:=greatest(tail,default_tail);
          IF tail IS NOT NULL AND (TG_OP='UPDATE' OR tail>=base) THEN
            INSERT INTO note_order_positions(account_id,scope,memory_id,rank) VALUES(NEW.account_id,container,NEW.id,ceil(tail)+1024)
              ON CONFLICT(account_id,scope,memory_id) DO UPDATE SET rank=EXCLUDED.rank;
          END IF;
        END LOOP;
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_note_order_append() FROM PUBLIC;
      CREATE TRIGGER note_order_append AFTER INSERT OR UPDATE OF project_id ON memories
        FOR EACH ROW EXECUTE FUNCTION grove_note_order_append();
    `);
  },
  async down() {
    throw new Error("Use a forward migration; preserve note order");
  },
};
