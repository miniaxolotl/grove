import type { Knex } from "knex";
export const browserCapture = {
  name: "20261105_037_browser_capture",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE web_captures (
        account_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
        provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object' AND length(provenance::text)<=10000),
        active boolean NOT NULL DEFAULT true,
        PRIMARY KEY(account_id,memory_id,version),
        FOREIGN KEY(account_id,memory_id) REFERENCES memories(account_id,id) ON DELETE CASCADE
      );
      ALTER TABLE web_captures ENABLE ROW LEVEL SECURITY;
      ALTER TABLE web_captures FORCE ROW LEVEL SECURITY;
      CREATE POLICY web_captures_tenant ON web_captures USING (
        account_id=nullif(current_setting('grove.account_id',true),'')::uuid
        AND EXISTS(SELECT 1 FROM memories m WHERE m.id=memory_id AND m.account_id=web_captures.account_id)
      ) WITH CHECK (
        account_id=nullif(current_setting('grove.account_id',true),'')::uuid
        AND EXISTS(SELECT 1 FROM memories m WHERE m.id=memory_id AND m.account_id=web_captures.account_id)
      );
      GRANT SELECT,INSERT,UPDATE ON web_captures TO grove_runtime,grove_worker;
      CREATE INDEX web_captures_url ON web_captures(account_id,(provenance->>'url'),memory_id) WHERE active;
      CREATE UNIQUE INDEX web_captures_one_active ON web_captures(account_id,memory_id) WHERE active;
      CREATE FUNCTION grove_invalidate_web_capture() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog AS $$ BEGIN
        IF NEW.content IS DISTINCT FROM OLD.content THEN
          UPDATE public.web_captures SET active=false WHERE account_id=OLD.account_id AND memory_id=OLD.id AND active;
        END IF;
        RETURN NEW; END $$;
      REVOKE ALL ON FUNCTION grove_invalidate_web_capture() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_invalidate_web_capture() TO grove_runtime,grove_worker;
      CREATE TRIGGER memories_invalidate_web_capture BEFORE UPDATE OF content ON memories
        FOR EACH ROW EXECUTE FUNCTION grove_invalidate_web_capture();
    `);
  },
  async down() {
    throw new Error("Use a forward migration; retain web provenance");
  },
};
