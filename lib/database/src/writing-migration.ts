import type { Knex } from "knex";

async function extendClaim(
  db: Knex,
  signature: string,
  edits: [string, string][],
) {
  const { rows } = await db.raw(
    "SELECT pg_get_functiondef(?::regprocedure) AS definition",
    [signature],
  );
  let definition = rows[0].definition as string;
  for (const [before, after] of edits) {
    if (definition.split(before).length !== 2)
      throw new Error("Unsupported queue claim baseline for writing migration");
    definition = definition.replace(before, after);
  }
  await db.raw(definition);
}

export const writingTools = {
  name: "20261106_038_writing_tools",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE connections ADD COLUMN writing_enabled boolean NOT NULL DEFAULT false;
      ALTER TABLE accounts ADD COLUMN sentence_rewrites_enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE background_tasks DROP CONSTRAINT background_tasks_kind_check;
      ALTER TABLE background_tasks ADD CONSTRAINT background_tasks_kind_check CHECK(kind IN
        ('export','account_cleanup','retention_cleanup','artifact_cleanup','model_backfill','import','connector_sync',
         'document_prepare','document_import','conversation_document','speech_transcribe','speech_synthesize','sentence_rewrite'));
      ALTER TABLE background_tasks ALTER COLUMN lane SET EXPRESSION AS
        (CASE WHEN kind='sentence_rewrite' THEN 'enrichment'
          WHEN kind IN ('account_cleanup','retention_cleanup','artifact_cleanup') THEN 'maintenance' ELSE 'bulk' END);
      CREATE TABLE writing_consents (
        account_id uuid NOT NULL, connection_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
        policy text NOT NULL, profile text NOT NULL, accepted boolean NOT NULL DEFAULT false,
        PRIMARY KEY(account_id,connection_id),
        FOREIGN KEY(account_id,connection_id) REFERENCES connections(account_id,id) ON DELETE CASCADE
      );
      CREATE TABLE writing_requests (
        account_id uuid NOT NULL, id uuid NOT NULL, connection_id uuid NOT NULL, session_id uuid NOT NULL,
        tool text NOT NULL CHECK(tool IN ('concise','verbose','rewrite','humanize','synonyms','antonyms')),
        fingerprint text NOT NULL, profile text NOT NULL, consent_version integer NOT NULL, epoch bigint NOT NULL,
        input_ciphertext text, result_ciphertext text,
        status text NOT NULL DEFAULT 'queued' CHECK(status IN
          ('queued','processing','backoff','uncertain','completed','failed','cancelled','expired')),
        provider_started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
        PRIMARY KEY(account_id,id),
        FOREIGN KEY(account_id,connection_id) REFERENCES connections(account_id,id) ON DELETE CASCADE
      );
      CREATE TABLE writing_cancellations (
        account_id uuid NOT NULL, id uuid NOT NULL, connection_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,id),
        FOREIGN KEY(account_id,connection_id) REFERENCES connections(account_id,id) ON DELETE CASCADE
      );
      CREATE INDEX writing_requests_expiry ON writing_requests(account_id,expires_at,id)
        WHERE input_ciphertext IS NOT NULL OR result_ciphertext IS NOT NULL;
    `);
    for (const table of [
      "writing_consents",
      "writing_requests",
      "writing_cancellations",
    ]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      await db.raw("ALTER TABLE ?? FORCE ROW LEVEL SECURITY", [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING (account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)`,
        [table],
      );
      await db.raw(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON ?? TO grove_runtime,grove_worker",
        [table],
      );
    }
    await db.raw(`
      CREATE FUNCTION grove_fence_writing() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,public,pg_temp AS $$
      DECLARE aid uuid; cid uuid;
      BEGIN
        IF TG_TABLE_NAME='connections' THEN
          IF NEW.writing_enabled IS NOT DISTINCT FROM OLD.writing_enabled AND NEW.revoked_at IS NOT DISTINCT FROM OLD.revoked_at
            AND NEW.authorized_after IS NOT DISTINCT FROM OLD.authorized_after THEN RETURN NEW; END IF;
          aid:=NEW.account_id; cid:=NEW.id;
        ELSE
          IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.sentence_rewrites_enabled IS NOT DISTINCT FROM OLD.sentence_rewrites_enabled THEN RETURN NEW; END IF;
          aid:=NEW.id;
        END IF;
        UPDATE writing_consents SET accepted=false,version=version+1 WHERE account_id=aid AND (cid IS NULL OR connection_id=cid);
        UPDATE writing_requests SET status=CASE WHEN provider_started_at IS NOT NULL AND status='processing' THEN 'uncertain' ELSE 'cancelled' END,
          input_ciphertext=NULL,result_ciphertext=NULL WHERE account_id=aid AND (cid IS NULL OR connection_id=cid);
        UPDATE background_tasks SET status='cancelled',lease_id=NULL,lease_until=NULL,result=NULL,updated_at=now()
          WHERE account_id=aid AND kind='sentence_rewrite'
            AND id IN (SELECT id FROM writing_requests WHERE account_id=aid AND (cid IS NULL OR connection_id=cid));
        UPDATE action_usage SET status=CASE WHEN worked THEN 'completed' ELSE 'released' END,updated_at=now()
          WHERE account_id=aid AND metric='assistance' AND status='reserved'
            AND operation IN (SELECT 'writing:'||id::text FROM writing_requests WHERE account_id=aid AND (cid IS NULL OR connection_id=cid));
        RETURN NEW;
      END $$;
      REVOKE ALL ON FUNCTION grove_fence_writing() FROM PUBLIC;
      CREATE TRIGGER writing_connection_changed AFTER UPDATE OF writing_enabled,revoked_at,authorized_after
        ON connections FOR EACH ROW EXECUTE FUNCTION grove_fence_writing();
      CREATE TRIGGER writing_account_changed AFTER UPDATE OF status,sentence_rewrites_enabled
        ON accounts FOR EACH ROW EXECUTE FUNCTION grove_fence_writing();
    `);
    // Extend the existing lane admission lock/counters rather than introduce a
    // second provider semaphore or silently expand capacity for the new task kind.
    await extendClaim(
      db,
      "grove_claim_processing(text[],uuid,text,integer,integer)",
      [
        [
          "(SELECT count(*) FROM jobs busy WHERE busy.account_id=j.account_id AND busy.lane=j.lane AND busy.lease_until>now())",
          "((SELECT count(*) FROM jobs busy WHERE busy.account_id=j.account_id AND busy.lane=j.lane AND busy.lease_until>now()) + (SELECT count(*) FROM background_tasks t WHERE t.account_id=j.account_id AND t.lane=j.lane AND t.status='running' AND t.lease_until>now()))",
        ],
        [
          "(SELECT count(*) FROM jobs WHERE lane=selected_lane AND lease_until>now())",
          "((SELECT count(*) FROM jobs WHERE lane=selected_lane AND lease_until>now()) + (SELECT count(*) FROM background_tasks WHERE lane=selected_lane AND status='running' AND lease_until>now()))",
        ],
        [
          "(SELECT count(*) FROM jobs WHERE account_id=owner_id AND lane=selected_lane AND lease_until>now())",
          "((SELECT count(*) FROM jobs WHERE account_id=owner_id AND lane=selected_lane AND lease_until>now()) + (SELECT count(*) FROM background_tasks WHERE account_id=owner_id AND lane=selected_lane AND status='running' AND lease_until>now()))",
        ],
      ],
    );
    await extendClaim(db, "grove_claim_task(uuid,text,integer)", [
      [
        "PERFORM 1 FROM background_tasks t WHERE t.id=selected",
        `IF selected_lane='enrichment' THEN
          IF NOT pg_try_advisory_xact_lock(hashtextextended(selected_lane,68142020)) THEN CONTINUE; END IF;
          IF ((SELECT count(*) FROM jobs WHERE lane=selected_lane AND lease_until>now()) +
              (SELECT count(*) FROM background_tasks WHERE lane=selected_lane AND status='running' AND lease_until>now()))
            >= greatest(1,least(COALESCE(NULLIF(current_setting('grove.provider_limit',true),''),'8')::integer,128)) THEN RETURN; END IF;
          IF ((SELECT count(*) FROM jobs WHERE account_id=owner_id AND lane=selected_lane AND lease_until>now()) +
              (SELECT count(*) FROM background_tasks WHERE account_id=owner_id AND lane=selected_lane AND status='running' AND lease_until>now()))
            >= greatest(1,least(account_limit,32)) THEN CONTINUE; END IF;
        END IF;
        PERFORM 1 FROM background_tasks t WHERE t.id=selected`,
      ],
    ]);
    await extendClaim(db, "grove_schedule_cleanup()", [
      [
        "OR EXISTS(SELECT 1 FROM document_import_batches b",
        "OR EXISTS(SELECT 1 FROM writing_requests w WHERE w.account_id=a.id AND w.expires_at<=now() AND (w.input_ciphertext IS NOT NULL OR w.result_ciphertext IS NOT NULL)) OR EXISTS(SELECT 1 FROM document_import_batches b",
      ],
    ]);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
