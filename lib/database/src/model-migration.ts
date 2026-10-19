import type { Knex } from "knex";

export const modelProviders = {
  // 004 belongs to the independently reviewed cloud-onboarding PR.
  name: "20261019_005_model_providers",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE model_settings (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        version integer NOT NULL DEFAULT 0, encrypted text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      GRANT SELECT ON model_settings TO grove_runtime, grove_worker;
      GRANT INSERT, UPDATE ON model_settings TO grove_runtime;
      CREATE TABLE embedding_profiles (
        id text PRIMARY KEY, model text NOT NULL, dimensions integer NOT NULL CHECK (dimensions BETWEEN 32 AND 16000),
        created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id, dimensions)
      );
      GRANT SELECT, INSERT ON embedding_profiles TO grove_runtime, grove_worker;
      INSERT INTO embedding_profiles(id, model, dimensions)
        SELECT DISTINCT profile, 'legacy', 384 FROM memory_embeddings;
      ALTER TABLE memory_embeddings ALTER COLUMN embedding TYPE vector;
      ALTER TABLE memory_embeddings ADD COLUMN dimensions integer NOT NULL DEFAULT 384;
      ALTER TABLE memory_embeddings ADD CONSTRAINT embedding_dimensions CHECK (vector_dims(embedding) = dimensions);
      ALTER TABLE memory_embeddings ADD CONSTRAINT embedding_profile_fk FOREIGN KEY (profile, dimensions) REFERENCES embedding_profiles(id, dimensions);
      ALTER TABLE memories ADD COLUMN auto_kind boolean NOT NULL DEFAULT false;
      ALTER TABLE accounts ADD COLUMN organize_enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE accounts ADD COLUMN summaries_enabled boolean NOT NULL DEFAULT true;

      ALTER TABLE jobs DROP CONSTRAINT jobs_account_id_memory_id_version_key;
      ALTER TABLE jobs ALTER COLUMN memory_id DROP NOT NULL;
      ALTER TABLE jobs ALTER COLUMN version DROP NOT NULL;
      ALTER TABLE jobs ADD COLUMN kind text NOT NULL DEFAULT 'embedding' CHECK (kind IN ('embedding','decision','organization','brief'));
      ALTER TABLE jobs ADD COLUMN profile text NOT NULL DEFAULT 'minilm-l6-v2-mean-normalized-v1';
      ALTER TABLE jobs ADD COLUMN target text;
      UPDATE jobs SET target = memory_id::text;
      ALTER TABLE jobs ALTER COLUMN target SET NOT NULL;
      ALTER TABLE jobs ADD COLUMN scope jsonb;
      ALTER TABLE jobs ADD CONSTRAINT job_target CHECK ((kind = 'brief' AND memory_id IS NULL AND version IS NULL AND scope IS NOT NULL) OR (kind <> 'brief' AND memory_id IS NOT NULL AND version IS NOT NULL));
      ALTER TABLE jobs ADD CONSTRAINT job_identity UNIQUE(account_id, kind, target, profile);

      CREATE TABLE memory_enrichments (
        account_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL,
        kind text NOT NULL CHECK (kind IN ('decision','organization')), profile text NOT NULL,
        data jsonb NOT NULL, sources jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id, memory_id, version, kind, profile),
        FOREIGN KEY(account_id, memory_id, version) REFERENCES memory_revisions ON DELETE CASCADE
      );
      CREATE TABLE memory_briefs (
        account_id uuid NOT NULL REFERENCES accounts(id), target text NOT NULL,
        scope jsonb NOT NULL, profile text NOT NULL, content_version integer NOT NULL,
        content jsonb NOT NULL, sources jsonb NOT NULL, truncated boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id, target, profile)
      );
      CREATE TABLE inference_usage (
        account_id uuid NOT NULL REFERENCES accounts(id), day date NOT NULL DEFAULT CURRENT_DATE,
        role text NOT NULL, requests integer NOT NULL DEFAULT 0, input_tokens bigint NOT NULL DEFAULT 0,
        output_tokens bigint NOT NULL DEFAULT 0, PRIMARY KEY(account_id, day, role)
      );
    `);
    for (const table of [
      "memory_enrichments",
      "memory_briefs",
      "inference_usage",
    ]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      await db.raw(
        "CREATE POLICY tenant ON ?? USING (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid) WITH CHECK (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid)",
        [table],
      );
      await db.raw(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ?? TO grove_runtime, grove_worker",
        [table],
      );
    }
    await db.raw(`
      DROP FUNCTION grove_claim_job();
      CREATE FUNCTION grove_claim_job(profiles text[] DEFAULT NULL) RETURNS SETOF jobs
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE jobs SET failed_at = now(), error_code = 'lease_exhausted'
          WHERE failed_at IS NULL AND attempts >= 5 AND (lease_until IS NULL OR lease_until < now());
        RETURN QUERY UPDATE jobs SET lease_id = gen_random_uuid(), lease_until = now() + interval '120 seconds', attempts = attempts + 1
          WHERE id = (SELECT j.id FROM jobs j JOIN accounts a ON a.id = j.account_id
            WHERE a.status = 'active' AND j.failed_at IS NULL AND j.attempts < 5 AND j.due_at <= now()
            AND (profiles IS NULL OR j.profile = ANY(profiles))
            AND (j.kind <> 'decision' OR NOT EXISTS (SELECT 1 FROM jobs e WHERE e.account_id = j.account_id AND e.target = j.target AND e.kind = 'embedding' AND e.failed_at IS NULL AND (profiles IS NULL OR e.profile = ANY(profiles))))
            AND (j.kind <> 'brief' OR NOT EXISTS (SELECT 1 FROM jobs e WHERE e.account_id = j.account_id AND e.kind <> 'brief' AND e.failed_at IS NULL AND (profiles IS NULL OR e.profile = ANY(profiles))))
            AND (j.lease_until IS NULL OR j.lease_until < now()) ORDER BY j.due_at, j.id
            FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING *;
      END $$;
      REVOKE ALL ON FUNCTION grove_claim_job(text[]) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_claim_job(text[]) TO grove_worker;
      CREATE FUNCTION grove_reprocess(embedding_profile text, decision_profile text, generation_profile text) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        DELETE FROM jobs;
        DELETE FROM memory_briefs;
        INSERT INTO jobs(account_id, memory_id, version, target, kind, profile)
          SELECT m.account_id, m.id, m.version, m.id::text, p.kind, p.profile
          FROM memories m JOIN accounts a ON a.id = m.account_id
          CROSS JOIN (VALUES ('embedding', embedding_profile), ('decision', decision_profile), ('organization', generation_profile)) AS p(kind, profile)
          WHERE a.status = 'active' AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > now())
            AND p.profile IS NOT NULL AND (p.kind = 'embedding' OR a.organize_enabled);
        IF generation_profile IS NOT NULL THEN
          INSERT INTO jobs(account_id, kind, target, profile, scope, due_at)
            SELECT DISTINCT m.account_id, 'brief', COALESCE(m.project_id::text, 'personal'), generation_profile,
              jsonb_build_object('projectId', m.project_id), now() + interval '5 seconds'
            FROM memories m JOIN accounts a ON a.id = m.account_id
            WHERE a.status = 'active' AND a.summaries_enabled AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > now());
          INSERT INTO jobs(account_id, kind, target, profile, scope, due_at)
            SELECT m.account_id, 'brief', COALESCE(m.project_id::text, 'personal') || ':task:' || m.task_id, generation_profile,
              jsonb_build_object('projectId', m.project_id, 'taskId', m.task_id), now() + interval '5 seconds'
            FROM memories m JOIN accounts a ON a.id = m.account_id
            WHERE a.status = 'active' AND a.summaries_enabled AND m.status = 'active' AND m.kind = 'handoff' AND m.expires_at > now();
        END IF;
      END $$;
      REVOKE ALL ON FUNCTION grove_reprocess(text,text,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_reprocess(text,text,text) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
