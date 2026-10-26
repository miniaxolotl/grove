import type { Knex } from "knex";

export const searchQuality = {
  name: "20261025_029_search_quality",
  async up(db: Knex) {
    // Keep body positions, retained rows and existing relationship queries intact.
    // Trigram predicates are evaluated after RLS; do not claim an owner GIN plan
    // justifies the write/storage cost of an additional runtime index.
    await db.raw(String.raw`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE FUNCTION grove_search_title(note_content text, organized_title text)
      RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
      SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE whitespace text := E' \t\n\r\v\f' || chr(160) || chr(5760) ||
        chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||
        chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||
        chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
        first_line text; heading text; value text; result text := '';
        units integer := 0; c text; i integer;
      BEGIN
        first_line := split_part(btrim(note_content,whitespace), E'\n',1);
        heading := btrim(substring(first_line FROM ('^#{1,6}['||whitespace||']+(.+)')),whitespace);
        IF heading IS NOT NULL AND heading<>'' THEN value:=heading;
        ELSIF organized_title IS NOT NULL AND organized_title<>'' THEN RETURN organized_title;
        ELSE value:=first_line; END IF;
        IF length(value)<=55 THEN RETURN value; END IF;
        IF octet_length(value)=length(value) THEN RETURN left(value,110); END IF;
        FOR i IN 1..least(length(value),110) LOOP
          c:=substr(value,i,1);
          units:=units+CASE WHEN ascii(c)>65535 THEN 2 ELSE 1 END;
          EXIT WHEN units>110;
          result:=result||c;
        END LOOP;
        RETURN result;
      END $$;
      REVOKE ALL ON FUNCTION grove_search_title(text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_search_title(text,text) TO grove_runtime,grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
