import type { Knex } from "knex";

export const speechDuration = {
  name: "20261025_026_speech_duration",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE speech_usage ADD COLUMN duration_ms bigint NOT NULL DEFAULT 0 CHECK(duration_ms>=0);
      -- Retain character counters. Unknown historical audio/failed attempts get
      -- a conservative bound: 3 MiB of MP3 at minimum 8 kbps plus one 72 ms frame.
      -- Do not reset current-month usage or claim an exact conversion from text.
      UPDATE speech_usage SET duration_ms=requests::bigint*3145800 WHERE kind='speech_synthesize';
      CREATE FUNCTION grove_speech_legacy_duration() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF NEW.kind='speech_synthesize' THEN
          IF TG_OP='INSERT' AND NEW.requests>0 AND NEW.duration_ms=0 THEN
            NEW.duration_ms:=NEW.requests::bigint*3145800;
          ELSIF TG_OP='UPDATE' AND NEW.requests>OLD.requests AND NEW.duration_ms=OLD.duration_ms THEN
            NEW.duration_ms:=OLD.duration_ms+(NEW.requests-OLD.requests)::bigint*3145800;
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_speech_legacy_duration() FROM PUBLIC;
      CREATE TRIGGER speech_legacy_duration BEFORE INSERT OR UPDATE ON speech_usage
        FOR EACH ROW EXECUTE FUNCTION grove_speech_legacy_duration();
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
