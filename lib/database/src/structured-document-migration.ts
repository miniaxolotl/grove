import type { Knex } from "knex";
export const structuredDocuments = {
  name: "20261105_036_structured_documents",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE memory_revisions ADD COLUMN document jsonb, ADD COLUMN change jsonb, ADD COLUMN actor jsonb;
      CREATE FUNCTION grove_document_matches(doc jsonb, note uuid, revision integer, source text)
      RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
        SELECT doc IS NULL OR (
          doc->>'schemaVersion'='1' AND doc->>'noteId'=note::text AND doc->>'revision'=revision::text
          AND jsonb_typeof(doc->'blocks')='array'
          AND (SELECT string_agg(b->>'source','' ORDER BY ordinal)
            FROM jsonb_array_elements(doc->'blocks') WITH ORDINALITY AS blocks(b,ordinal))=source
        ) IS TRUE
      $$;
      ALTER TABLE memory_revisions ADD CONSTRAINT revision_document_projection
        CHECK (grove_document_matches(document,memory_id,version,content));
    `);
  },
  async down() {
    throw new Error("Use a forward migration; retain structured history");
  },
};
