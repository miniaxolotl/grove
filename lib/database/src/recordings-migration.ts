import type { Knex } from "knex";
export const recordings = {
  name: "20261023_018_recordings",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE media_objects DROP CONSTRAINT media_objects_mime_check,
        DROP CONSTRAINT media_objects_check,
        ADD COLUMN duration_ms integer CHECK(duration_ms BETWEEN 1 AND 60000),
        ADD CONSTRAINT media_objects_mime_check CHECK(mime IN ('image/png','image/jpeg','image/webp','audio/wav')),
        ADD CONSTRAINT media_objects_complete CHECK(status<>'ready' OR
          (mime='audio/wav' AND duration_ms>0) OR (mime<>'audio/wav' AND width>0 AND height>0));
      CREATE TABLE media_transcripts (
        account_id uuid NOT NULL, media_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
        text text NOT NULL DEFAULT '' CHECK(length(text)<=6000), operation_id uuid NOT NULL,
        fingerprint text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id,media_id), FOREIGN KEY(account_id,media_id) REFERENCES media_objects(account_id,id)
      );
      ALTER TABLE media_transcripts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE media_transcripts FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON media_transcripts USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      CREATE POLICY visible_media ON media_transcripts AS RESTRICTIVE USING(EXISTS(
        SELECT 1 FROM media_objects o WHERE o.account_id=media_transcripts.account_id AND o.id=media_transcripts.media_id)) WITH CHECK(true);
      GRANT SELECT,INSERT,UPDATE ON media_transcripts TO grove_runtime,grove_worker;
      CREATE TABLE media_transcript_revisions (
        account_id uuid NOT NULL, media_id uuid NOT NULL, version integer NOT NULL, text text NOT NULL CHECK(length(text)<=6000),
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,media_id,version),
        FOREIGN KEY(account_id,media_id) REFERENCES media_transcripts(account_id,media_id)
      );
      ALTER TABLE media_transcript_revisions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE media_transcript_revisions FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON media_transcript_revisions USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      CREATE POLICY visible_media ON media_transcript_revisions AS RESTRICTIVE USING(EXISTS(
        SELECT 1 FROM media_objects o WHERE o.account_id=media_transcript_revisions.account_id AND o.id=media_transcript_revisions.media_id)) WITH CHECK(true);
      GRANT SELECT,INSERT ON media_transcript_revisions TO grove_runtime,grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
