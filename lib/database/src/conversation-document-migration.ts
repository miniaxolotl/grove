import type { Knex } from "knex";

export const conversationDocuments = {
  name: "20261025_032_conversation_documents",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE conversations ADD COLUMN documents_version integer NOT NULL DEFAULT 0;
      ALTER TABLE conversation_turns ADD COLUMN document_snapshot jsonb NOT NULL DEFAULT '[]',ADD COLUMN documents_version integer;
      ALTER TABLE background_tasks DROP CONSTRAINT background_tasks_kind_check;
      ALTER TABLE background_tasks ADD CONSTRAINT background_tasks_kind_check CHECK(kind IN
        ('export','account_cleanup','retention_cleanup','artifact_cleanup','model_backfill','import','connector_sync','speech_transcribe','speech_synthesize','document_prepare','document_import','conversation_document'));
      CREATE TABLE conversation_documents (
        account_id uuid NOT NULL,conversation_id uuid NOT NULL,id uuid NOT NULL,
        filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 3145728),
        sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),staging bytea CHECK(octet_length(staging)<=3145728),
        mime text,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','failed')),
        version integer NOT NULL DEFAULT 1,task_id uuid NOT NULL,error text,pages integer,empty_pages jsonb NOT NULL DEFAULT '[]',
        object_key text,accepted boolean NOT NULL DEFAULT false,accept_lease uuid,accept_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',removed_at timestamptz,
        PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,conversation_id) REFERENCES conversations(account_id,id),
        FOREIGN KEY(account_id,task_id) REFERENCES background_tasks(account_id,id)
      );
      CREATE INDEX conversation_documents_chat ON conversation_documents(account_id,conversation_id,created_at,id);
      CREATE TABLE conversation_document_chunks (
        account_id uuid NOT NULL,document_id uuid NOT NULL,id uuid NOT NULL,ordinal integer NOT NULL,
        content text NOT NULL CHECK(length(content) BETWEEN 1 AND 6000),page_start integer NOT NULL,page_end integer NOT NULL,
        source_start integer NOT NULL,source_end integer NOT NULL,
        search tsvector GENERATED ALWAYS AS(to_tsvector('english',content)) STORED,
        PRIMARY KEY(account_id,id),UNIQUE(account_id,document_id,ordinal),
        FOREIGN KEY(account_id,document_id) REFERENCES conversation_documents(account_id,id)
      );
      CREATE INDEX conversation_document_search ON conversation_document_chunks USING gin(search);
      CREATE TABLE conversation_document_attempts (
        account_id uuid NOT NULL,document_id uuid NOT NULL,id uuid NOT NULL,object_key text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(account_id,id),
        FOREIGN KEY(account_id,document_id) REFERENCES conversation_documents(account_id,id)
      );
      CREATE TABLE conversation_document_imports (
        account_id uuid NOT NULL,id uuid NOT NULL,conversation_id uuid NOT NULL,version integer NOT NULL,batch_id uuid NOT NULL,
        PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,conversation_id) REFERENCES conversations(account_id,id),
        FOREIGN KEY(account_id,batch_id) REFERENCES document_import_batches(account_id,id)
      );
      CREATE TABLE conversation_document_bindings (
        account_id uuid NOT NULL,memory_id uuid NOT NULL,version integer NOT NULL,document_id uuid NOT NULL,
        chunk_id uuid NOT NULL,quote text NOT NULL,
        PRIMARY KEY(account_id,memory_id,version,chunk_id),
        FOREIGN KEY(account_id,memory_id) REFERENCES memories(account_id,id),
        FOREIGN KEY(account_id,document_id) REFERENCES conversation_documents(account_id,id),
        FOREIGN KEY(account_id,chunk_id) REFERENCES conversation_document_chunks(account_id,id)
      );
      CREATE TABLE conversation_document_handoffs (
        account_id uuid NOT NULL,id uuid NOT NULL,batch_id uuid NOT NULL,version integer NOT NULL,
        PRIMARY KEY(account_id,id),FOREIGN KEY(account_id,id) REFERENCES conversations(account_id,id),
        FOREIGN KEY(account_id,batch_id) REFERENCES document_import_batches(account_id,id)
      );
    `);
    for (const table of [
      "conversation_documents",
      "conversation_document_chunks",
      "conversation_document_attempts",
      "conversation_document_imports",
      "conversation_document_bindings",
      "conversation_document_handoffs",
    ]) {
      await db.raw(
        "ALTER TABLE ?? ENABLE ROW LEVEL SECURITY; ALTER TABLE ?? FORCE ROW LEVEL SECURITY",
        [table, table],
      );
      await db.raw(
        `CREATE POLICY tenant ON ?? USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid) WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw(
        `CREATE POLICY active_owner ON ?? AS RESTRICTIVE USING(EXISTS(SELECT 1 FROM accounts a WHERE a.id=??.account_id AND a.status='active')) WITH CHECK(true)`,
        [table, table],
      );
      await db.raw(
        "GRANT SELECT,INSERT,UPDATE ON ?? TO grove_runtime,grove_worker",
        [table],
      );
    }
    await db.raw(`
      CREATE POLICY visible_chat ON conversation_documents AS RESTRICTIVE USING
        (EXISTS(SELECT 1 FROM conversations c WHERE c.account_id=conversation_documents.account_id AND c.id=conversation_documents.conversation_id AND c.deleted_at IS NULL)
          OR EXISTS(SELECT 1 FROM conversation_document_bindings b JOIN memories m ON m.account_id=b.account_id AND m.id=b.memory_id
            WHERE b.account_id=conversation_documents.account_id AND b.document_id=conversation_documents.id AND m.deleted_at IS NULL)) WITH CHECK(true);
      CREATE POLICY visible_memory ON conversation_document_bindings AS RESTRICTIVE USING
        (EXISTS(SELECT 1 FROM memories m WHERE m.account_id=conversation_document_bindings.account_id AND m.id=conversation_document_bindings.memory_id AND m.deleted_at IS NULL)) WITH CHECK(true);
      CREATE POLICY visible_document ON conversation_document_chunks AS RESTRICTIVE USING
        (EXISTS(SELECT 1 FROM conversation_documents d WHERE d.account_id=conversation_document_chunks.account_id AND d.id=conversation_document_chunks.document_id AND d.removed_at IS NULL)) WITH CHECK(true);
      REVOKE UPDATE ON conversation_document_attempts,conversation_document_imports,conversation_document_bindings,conversation_document_handoffs FROM grove_runtime,grove_worker;
      CREATE FUNCTION grove_immutable_chat_document() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF (NEW.account_id,NEW.conversation_id,NEW.id,NEW.filename,NEW.bytes,NEW.sha256,NEW.version) IS DISTINCT FROM
          (OLD.account_id,OLD.conversation_id,OLD.id,OLD.filename,OLD.bytes,OLD.sha256,OLD.version) THEN RAISE EXCEPTION 'document_identity_immutable'; END IF;
        IF OLD.accepted AND (NEW.object_key,NEW.mime,NEW.pages,NEW.accepted,NEW.staging,NEW.status) IS DISTINCT FROM
          (OLD.object_key,OLD.mime,OLD.pages,OLD.accepted,OLD.staging,OLD.status) THEN RAISE EXCEPTION 'document_source_immutable'; END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_immutable_chat_document() FROM PUBLIC;
      CREATE TRIGGER immutable_chat_document BEFORE UPDATE ON conversation_documents FOR EACH ROW EXECUTE FUNCTION grove_immutable_chat_document();
      CREATE FUNCTION grove_chat_document_chunks_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
      BEGIN
        IF TG_OP='UPDATE' AND (NEW.account_id,NEW.id,NEW.document_id,NEW.ordinal,NEW.page_start,NEW.page_end,NEW.source_start,NEW.source_end)
          IS DISTINCT FROM (OLD.account_id,OLD.id,OLD.document_id,OLD.ordinal,OLD.page_start,OLD.page_end,OLD.source_start,OLD.source_end) THEN RAISE EXCEPTION 'document_identity_immutable'; END IF;
        IF EXISTS(SELECT 1 FROM conversation_documents d WHERE d.account_id=NEW.account_id AND d.id=NEW.document_id AND d.accepted) THEN RAISE EXCEPTION 'document_source_immutable'; END IF;
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_chat_document_chunks_immutable() FROM PUBLIC;
      CREATE TRIGGER immutable_chat_chunks BEFORE INSERT OR UPDATE ON conversation_document_chunks FOR EACH ROW EXECUTE FUNCTION grove_chat_document_chunks_immutable();
      CREATE FUNCTION grove_clear_chat_uploads() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE previous_scope text; owner_id uuid; chat_id uuid;
      BEGIN
        previous_scope:=current_setting('grove.account_id',true);
        IF TG_TABLE_NAME='accounts' THEN owner_id:=OLD.id;chat_id:=NULL;ELSE owner_id:=OLD.account_id;chat_id:=OLD.id;END IF;
        PERFORM set_config('grove.account_id',owner_id::text,true);
        UPDATE conversation_document_chunks SET content='[Upload unavailable]' WHERE account_id=owner_id AND document_id IN
          (SELECT id FROM conversation_documents WHERE account_id=owner_id AND NOT accepted AND removed_at IS NULL AND (chat_id IS NULL OR conversation_id=chat_id));
        UPDATE conversation_documents SET staging=NULL,removed_at=now(),accept_lease=NULL,accept_until=NULL WHERE account_id=owner_id AND NOT accepted AND (chat_id IS NULL OR conversation_id=chat_id);
        PERFORM set_config('grove.account_id',coalesce(previous_scope,''),true);
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_clear_chat_uploads() FROM PUBLIC;
      CREATE TRIGGER clear_account_chat_uploads BEFORE UPDATE OF status ON accounts FOR EACH ROW WHEN(OLD.status='active' AND NEW.status<>'active') EXECUTE FUNCTION grove_clear_chat_uploads();
      CREATE TRIGGER clear_deleted_chat_uploads BEFORE UPDATE OF deleted_at ON conversations FOR EACH ROW WHEN(OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) EXECUTE FUNCTION grove_clear_chat_uploads();
    `);
    const { rows } = await db.raw(
      "SELECT pg_get_functiondef('grove_schedule_cleanup()'::regprocedure) AS definition",
    );
    await db.raw(
      rows[0].definition.replace(
        "OR EXISTS(SELECT 1 FROM document_import_batches b",
        "OR EXISTS(SELECT 1 FROM conversation_documents d WHERE d.account_id=a.id AND NOT d.accepted AND d.removed_at IS NULL AND d.expires_at<=now()) OR EXISTS(SELECT 1 FROM document_import_batches b",
      ),
    );
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
