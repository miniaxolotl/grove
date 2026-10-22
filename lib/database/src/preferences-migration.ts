import type { Knex } from "knex";

export const aiPreferences = {
  name: "20261022_013_ai_preferences",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts
        ADD COLUMN titles_tags_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN classification_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN note_connections_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN notebook_connections_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN notebook_summaries_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN personal_summary_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN progress_summaries_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN ask_enabled boolean NOT NULL DEFAULT true;
      UPDATE accounts SET
        titles_tags_enabled=organize_enabled, classification_enabled=organize_enabled,
        note_connections_enabled=organize_enabled, notebook_connections_enabled=organize_enabled,
        notebook_summaries_enabled=summaries_enabled, personal_summary_enabled=summaries_enabled,
        progress_summaries_enabled=summaries_enabled, ask_enabled=summaries_enabled;

      CREATE OR REPLACE FUNCTION grove_reprocess(embedding_profile text, decision_profile text, generation_profile text) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        DELETE FROM jobs;
        DELETE FROM memory_briefs;
        DELETE FROM notebook_profiles;
        DELETE FROM memory_enrichments WHERE kind='relationship_scan';
        UPDATE accounts SET organization_due_at=now();
        INSERT INTO jobs(account_id, memory_id, version, target, kind, profile)
          SELECT m.account_id, m.id, m.version, m.id::text, p.kind, p.profile
          FROM memories m JOIN accounts a ON a.id=m.account_id
          CROSS JOIN (VALUES ('embedding',embedding_profile),('decision',decision_profile),('organization',generation_profile)) AS p(kind,profile)
          WHERE a.status='active' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())
            AND p.profile IS NOT NULL AND (p.kind='embedding'
              OR (p.kind='decision' AND a.classification_enabled)
              OR (p.kind='organization' AND a.titles_tags_enabled));
        IF generation_profile IS NOT NULL THEN
          INSERT INTO jobs(account_id,kind,target,profile,scope,due_at)
            SELECT DISTINCT m.account_id,'brief',COALESCE(m.project_id::text,'personal'),generation_profile,jsonb_build_object('projectId',m.project_id),now()+interval '5 seconds'
            FROM memories m JOIN accounts a ON a.id=m.account_id
            WHERE a.status='active' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>now())
              AND CASE WHEN m.project_id IS NULL THEN a.personal_summary_enabled ELSE a.notebook_summaries_enabled END;
          INSERT INTO jobs(account_id,kind,target,profile,scope,due_at)
            SELECT m.account_id,'brief',COALESCE(m.project_id::text,'personal')||':task:'||m.task_id,generation_profile,jsonb_build_object('projectId',m.project_id,'taskId',m.task_id),now()+interval '5 seconds'
            FROM memories m JOIN accounts a ON a.id=m.account_id
            WHERE a.status='active' AND a.progress_summaries_enabled AND m.status='active'
              AND m.kind='handoff' AND (m.expires_at IS NULL OR m.expires_at>now());
        END IF;
      END $$;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
