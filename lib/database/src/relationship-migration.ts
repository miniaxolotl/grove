import type { Knex } from "knex";

export const relationships = {
  name: "20261021_010_relationship_evidence",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE projects ADD COLUMN content_version integer NOT NULL DEFAULT 0;
      CREATE TABLE notebook_profiles (
        account_id uuid NOT NULL, project_id uuid NOT NULL, profile text NOT NULL,
        content_version integer NOT NULL, expires_at timestamptz,
        total integer NOT NULL DEFAULT 0, processed integer NOT NULL DEFAULT 0,
        after_id uuid, complete boolean NOT NULL DEFAULT false, data jsonb NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id, project_id, profile),
        FOREIGN KEY(account_id, project_id) REFERENCES projects(account_id, id) ON DELETE CASCADE
      );
    `);
    for (const [table, endpoint] of [
      ["memory_relationships", "memories"],
      ["notebook_relationships", "projects"],
    ]) {
      await db.raw(`
        CREATE TABLE ${table} (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
          left_id uuid NOT NULL, right_id uuid NOT NULL, profile text NOT NULL,
          left_version integer NOT NULL, right_version integer NOT NULL,
          revision text NOT NULL, assessment jsonb NOT NULL,
          expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
          dismissed_revision text, review_version integer NOT NULL DEFAULT 0,
          CHECK (left_id < right_id), UNIQUE(account_id, left_id, right_id),
          FOREIGN KEY(account_id, left_id) REFERENCES ${endpoint}(account_id, id) ON DELETE CASCADE,
          FOREIGN KEY(account_id, right_id) REFERENCES ${endpoint}(account_id, id) ON DELETE CASCADE
        );
        CREATE INDEX ${table}_right ON ${table}(account_id, right_id);
      `);
    }
    for (const table of [
      "notebook_profiles",
      "memory_relationships",
      "notebook_relationships",
    ]) {
      await db.raw(`ALTER TABLE ?? ENABLE ROW LEVEL SECURITY`, [table]);
      await db.raw(`ALTER TABLE ?? FORCE ROW LEVEL SECURITY`, [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid) WITH CHECK (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid)`,
        [table],
      );
      await db.raw(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ?? TO grove_runtime, grove_worker`,
        [table],
      );
    }
    await db.raw(`
      CREATE FUNCTION grove_notebook_content_changed() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          UPDATE projects SET content_version = content_version + 1 WHERE account_id = OLD.account_id AND id = OLD.project_id;
          UPDATE accounts SET organization_due_at = now() WHERE id = OLD.account_id;
        ELSE
          IF TG_OP = 'UPDATE' AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
            UPDATE projects SET content_version = content_version + 1 WHERE account_id = OLD.account_id AND id = OLD.project_id;
          END IF;
          UPDATE projects SET content_version = content_version + 1 WHERE account_id = NEW.account_id AND id = NEW.project_id;
          UPDATE accounts SET organization_due_at = now() WHERE id = NEW.account_id;
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER notebook_content_changed AFTER INSERT OR DELETE OR UPDATE OF content, version, project_id, status, expires_at ON memories
        FOR EACH ROW EXECUTE FUNCTION grove_notebook_content_changed();
      ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
      ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('embedding','decision','organization','brief','relationship_scan','note_relationship','notebook_profile','notebook_relationship'));
      ALTER TABLE jobs DROP CONSTRAINT job_target;
      ALTER TABLE jobs ADD CONSTRAINT job_target CHECK (
        (kind IN ('brief','note_relationship','notebook_profile','notebook_relationship') AND memory_id IS NULL AND version IS NULL AND scope IS NOT NULL)
        OR (kind IN ('embedding','decision','organization','relationship_scan') AND memory_id IS NOT NULL AND version IS NOT NULL)
      );
      CREATE OR REPLACE FUNCTION grove_claim_job(profiles text[] DEFAULT NULL, wanted uuid DEFAULT NULL) RETURNS SETOF jobs
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        UPDATE jobs SET failed_at = now(), error_code = 'lease_exhausted'
          WHERE failed_at IS NULL AND attempts >= 5 AND (lease_until IS NULL OR lease_until < now());
        RETURN QUERY UPDATE jobs SET lease_id = gen_random_uuid(), lease_until = now() + interval '120 seconds', attempts = attempts + 1
          WHERE id = (SELECT j.id FROM jobs j JOIN accounts a ON a.id = j.account_id
            WHERE a.status = 'active' AND j.failed_at IS NULL AND j.attempts < 5 AND j.due_at <= now()
            AND (wanted IS NULL OR j.id = wanted) AND (profiles IS NULL OR j.profile = ANY(profiles))
            AND (j.kind NOT IN ('decision','relationship_scan') OR NOT EXISTS (SELECT 1 FROM jobs e WHERE e.account_id = j.account_id AND e.target = j.target AND e.kind = 'embedding' AND e.failed_at IS NULL AND (profiles IS NULL OR e.profile = ANY(profiles))))
            AND (j.kind <> 'brief' OR NOT EXISTS (SELECT 1 FROM jobs e WHERE e.account_id = j.account_id AND e.kind IN ('embedding','decision','organization') AND e.failed_at IS NULL AND (profiles IS NULL OR e.profile = ANY(profiles))))
            AND (j.lease_until IS NULL OR j.lease_until < now()) ORDER BY j.due_at, j.id
            FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING *;
      END $$;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
