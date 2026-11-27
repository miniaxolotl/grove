import type { Knex } from "knex";

export const noteChunks = {
  name: "20261127_050_note_embedding_chunks",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE memory_embedding_chunks (
        account_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL,
        profile text NOT NULL, ordinal integer NOT NULL CHECK(ordinal>=0),
        chunker text NOT NULL, content_hash text NOT NULL CHECK(length(content_hash)=64),
        source_from integer NOT NULL CHECK(source_from>=0),
        source_to integer NOT NULL CHECK(source_to>source_from AND source_to-source_from<=2000),
        dimensions integer NOT NULL, embedding vector NOT NULL,
        CHECK(vector_dims(embedding)=dimensions),
        PRIMARY KEY(account_id,memory_id,version,profile,ordinal),
        FOREIGN KEY(account_id,memory_id,version) REFERENCES memory_revisions ON DELETE CASCADE,
        FOREIGN KEY(profile,dimensions) REFERENCES embedding_profiles(id,dimensions)
      );
      CREATE INDEX memory_chunk_reuse ON memory_embedding_chunks
        (account_id,memory_id,profile,chunker,content_hash);
      ALTER TABLE memory_embedding_chunks ENABLE ROW LEVEL SECURITY;
      ALTER TABLE memory_embedding_chunks FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON memory_embedding_chunks
        USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      CREATE POLICY visible_parent ON memory_embedding_chunks AS RESTRICTIVE
        USING(EXISTS(SELECT 1 FROM memories m WHERE m.account_id=memory_embedding_chunks.account_id
          AND m.id=memory_embedding_chunks.memory_id AND m.deleted_at IS NULL))
        WITH CHECK(EXISTS(SELECT 1 FROM memories m WHERE m.account_id=memory_embedding_chunks.account_id
          AND m.id=memory_embedding_chunks.memory_id AND m.deleted_at IS NULL AND m.status='active'
          AND (m.expires_at IS NULL OR m.expires_at>now())));
      GRANT SELECT ON memory_embedding_chunks TO grove_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON memory_embedding_chunks TO grove_worker;
      CREATE FUNCTION grove_erase_note_chunks() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
          DELETE FROM memory_embedding_chunks WHERE account_id=NEW.account_id AND memory_id=NEW.id;
        END IF;
        RETURN NULL;
      END $$;
      REVOKE ALL ON FUNCTION grove_erase_note_chunks() FROM PUBLIC;
      CREATE TRIGGER erased_note_chunks AFTER UPDATE OF deleted_at ON memories
        FOR EACH ROW EXECUTE FUNCTION grove_erase_note_chunks();
    `);
  },
  async down() {
    throw new Error("Use a forward migration; preserve chunk indexing state");
  },
};
