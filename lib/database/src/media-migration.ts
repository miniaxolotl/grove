import type { Knex } from "knex";

export const mediaAttachments = {
  name: "20261023_017_media_attachments",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN media_bytes bigint NOT NULL DEFAULT 0 CHECK(media_bytes>=0),
        ADD COLUMN media_attempts integer NOT NULL DEFAULT 0 CHECK(media_attempts>=0);
      CREATE TABLE media_objects (
        account_id uuid NOT NULL REFERENCES accounts(id), id uuid NOT NULL,
        memory_id uuid NOT NULL, mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
        bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 10485760), sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
        status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
        object_key text NOT NULL, lease_id uuid NOT NULL, lease_until timestamptz NOT NULL,
        width integer, height integer, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id,id), UNIQUE(account_id,id,memory_id), UNIQUE(object_key),
        FOREIGN KEY(account_id,memory_id) REFERENCES memories(account_id,id),
        CHECK(status<>'ready' OR (width>0 AND height>0))
      );
      CREATE TABLE media_upload_attempts (
        account_id uuid NOT NULL, media_id uuid NOT NULL, id uuid NOT NULL,
        object_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id,id), FOREIGN KEY(account_id,media_id) REFERENCES media_objects(account_id,id)
      );
      CREATE TABLE media_revision_bindings (
        account_id uuid NOT NULL, media_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL,
        PRIMARY KEY(account_id,memory_id,version,media_id),
        FOREIGN KEY(account_id,media_id,memory_id) REFERENCES media_objects(account_id,id,memory_id),
        FOREIGN KEY(account_id,memory_id,version) REFERENCES memory_revisions(account_id,memory_id,version)
      );
      CREATE INDEX media_note ON media_objects(account_id,memory_id);
    `);
    for (const table of [
      "media_objects",
      "media_upload_attempts",
      "media_revision_bindings",
    ]) {
      await db.raw(
        `ALTER TABLE ?? ENABLE ROW LEVEL SECURITY; ALTER TABLE ?? FORCE ROW LEVEL SECURITY`,
        [table, table],
      );
      await db.raw(
        `CREATE POLICY tenant ON ?? USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw(
        `CREATE POLICY active_owner ON ?? AS RESTRICTIVE USING(EXISTS(SELECT 1 FROM accounts a WHERE a.id=??.account_id AND a.status='active')) WITH CHECK(true)`,
        [table, table],
      );
      await db.raw(`GRANT SELECT,INSERT ON ?? TO grove_runtime,grove_worker`, [
        table,
      ]);
    }
    await db.raw(`
      GRANT UPDATE ON media_objects TO grove_runtime,grove_worker;
      CREATE FUNCTION grove_immutable_media() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF OLD.status='ready' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'published_media_immutable'; END IF;
        IF (NEW.account_id,NEW.id,NEW.memory_id,NEW.mime,NEW.bytes,NEW.sha256) IS DISTINCT FROM
           (OLD.account_id,OLD.id,OLD.memory_id,OLD.mime,OLD.bytes,OLD.sha256) THEN RAISE EXCEPTION 'media_identity_immutable'; END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_immutable_media() FROM PUBLIC;
      CREATE TRIGGER immutable_media BEFORE UPDATE ON media_objects FOR EACH ROW EXECUTE FUNCTION grove_immutable_media();
      CREATE POLICY visible_note ON media_objects AS RESTRICTIVE USING(EXISTS(
        SELECT 1 FROM memories m WHERE m.account_id=media_objects.account_id AND m.id=media_objects.memory_id)) WITH CHECK(true);
      CREATE POLICY visible_note ON media_revision_bindings AS RESTRICTIVE USING(EXISTS(
        SELECT 1 FROM memories m WHERE m.account_id=media_revision_bindings.account_id AND m.id=media_revision_bindings.memory_id)) WITH CHECK(true);
      CREATE FUNCTION grove_bind_media() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE identifier uuid;
      BEGIN
        FOR identifier IN SELECT DISTINCT matches[1]::uuid FROM regexp_matches(NEW.content,
          'grove-media:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})','g') AS matches
        LOOP
          IF NOT EXISTS(SELECT 1 FROM media_objects WHERE account_id=NEW.account_id AND id=identifier
            AND memory_id=NEW.memory_id AND status='ready') THEN
            RAISE EXCEPTION 'media_reference_unavailable' USING ERRCODE='23514';
          END IF;
          INSERT INTO media_revision_bindings(account_id,media_id,memory_id,version)
            VALUES(NEW.account_id,identifier,NEW.memory_id,NEW.version);
        END LOOP;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_bind_media() FROM PUBLIC;
      CREATE TRIGGER bind_media AFTER INSERT ON memory_revisions FOR EACH ROW EXECUTE FUNCTION grove_bind_media();

      CREATE FUNCTION grove_public_media(digest text, note_id uuid, media_id uuid) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE document jsonb; object jsonb;
      BEGIN
        -- The existing reader owns admission, account/share locks, subtree scope,
        -- current visibility and database-clock expiry. Never issue an owner grant.
        document:=grove_public_share(digest,'note',note_id,NULL,NULL,NULL,1);
        IF jsonb_exists(document,'limited') THEN RETURN document; END IF;
        IF document IS NULL OR document->'note' IS NULL THEN RETURN NULL; END IF;
        SELECT jsonb_build_object('key',o.object_key,'mime',o.mime,'bytes',o.bytes,'sha256',o.sha256) INTO object
          FROM media_objects o JOIN memories m ON m.account_id=o.account_id AND m.id=o.memory_id
          JOIN public_shares s ON s.account_id=o.account_id AND s.token_digest=digest
          JOIN media_revision_bindings b ON b.account_id=o.account_id AND b.media_id=o.id AND b.memory_id=m.id AND b.version=m.version
          WHERE m.id=note_id AND o.id=grove_public_media.media_id AND o.status='ready' AND m.deleted_at IS NULL
            AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp());
        RETURN object;
      END $$;
      REVOKE ALL ON FUNCTION grove_public_media(text,uuid,uuid) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_public_media(text,uuid,uuid) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error(
      "Use a forward migration; retained media cannot be rolled back",
    );
  },
};
