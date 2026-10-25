import type { Knex } from "knex";
import { billing } from "./billing-migration.ts";
import { systemAdministration } from "./system-admin-migration.ts";
import { adminSupport } from "./admin-support-migration.ts";
import { speechCache } from "./speech-cache-migration.ts";
import { speechDuration } from "./speech-duration-migration.ts";
import { speechVoices } from "./speech-voices-migration.ts";
import { hardening, identityState } from "./hardening.ts";
import { modelProviders } from "./model-migration.ts";
import { memoryLifetimes } from "./lifetime-migration.ts";
import { backgroundServices } from "./background-migration.ts";
import { nestedNotebooks } from "./notebook-migration.ts";
import { conversations } from "./conversation-migration.ts";
import { relationships } from "./relationship-migration.ts";
import { publicSharing } from "./sharing-migration.ts";
import { shareExpiration } from "./share-expiration-migration.ts";
import { aiPreferences } from "./preferences-migration.ts";
import { queueProcessing } from "./queue-migration.ts";
import { notebookAssistance } from "./assistance-migration.ts";
import { notebookLifecycle } from "./notebook-lifecycle-migration.ts";
import { mediaAttachments } from "./media-migration.ts";
import { recordings } from "./recordings-migration.ts";
import { speech } from "./speech-migration.ts";
import { researchTools } from "./research-migration.ts";
import { speechDefaults } from "./speech-defaults-migration.ts";

export const migrations = [
  {
    name: "20261018_001_private_memory",
    async up(db: Knex) {
      await db.raw(`
      CREATE EXTENSION IF NOT EXISTS vector;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grove_runtime') THEN
          CREATE ROLE grove_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grove_worker') THEN
          CREATE ROLE grove_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clerk_subject text UNIQUE NOT NULL,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleting','deleted')),
        content_version integer NOT NULL DEFAULT 0, capture_enabled boolean NOT NULL DEFAULT true,
        recall_enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz, provider_deleted_at timestamptz
      );
      CREATE TABLE projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id),
        name text NOT NULL, identity text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(account_id, id), UNIQUE(account_id, identity)
      );
      CREATE TABLE memories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id),
        project_id uuid, kind text NOT NULL CHECK (kind IN ('preference','fact','decision','solution','handoff')),
        content text NOT NULL CHECK (length(content) BETWEEN 1 AND 6000),
        search tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        source jsonb NOT NULL, task_id text, expires_at timestamptz, purge_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(account_id, id),
        FOREIGN KEY (account_id, project_id) REFERENCES projects(account_id, id),
        CHECK ((kind = 'handoff' AND task_id IS NOT NULL AND expires_at IS NOT NULL AND purge_at > expires_at)
          OR (kind <> 'handoff' AND task_id IS NULL AND expires_at IS NULL AND purge_at IS NULL))
      );
      CREATE UNIQUE INDEX memories_task ON memories(account_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'), task_id) WHERE task_id IS NOT NULL;
      CREATE INDEX memories_owner_page ON memories(account_id, id);
      CREATE INDEX memories_scope ON memories(account_id, project_id, status);
      CREATE INDEX memories_lexical ON memories USING gin(search);
      CREATE TABLE memory_revisions (
        account_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL,
        content text NOT NULL, source jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id, memory_id, version),
        FOREIGN KEY(account_id, memory_id) REFERENCES memories(account_id, id) ON DELETE CASCADE
      );
      CREATE TABLE memory_embeddings (
        account_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL,
        profile text NOT NULL, embedding vector(384) NOT NULL,
        PRIMARY KEY(account_id, memory_id, version, profile),
        FOREIGN KEY(account_id, memory_id, version) REFERENCES memory_revisions ON DELETE CASCADE
      );
      CREATE TABLE memory_operations (
        account_id uuid NOT NULL REFERENCES accounts(id), id uuid NOT NULL, fingerprint text NOT NULL,
        result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id, id)
      );
      CREATE TABLE connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES accounts(id),
        client_id text, name text NOT NULL, capabilities text[] NOT NULL,
        personal boolean NOT NULL DEFAULT false, all_projects boolean NOT NULL DEFAULT false,
        project_ids uuid[] NOT NULL DEFAULT '{}', revoked_at timestamptz, expires_at timestamptz,
        authorized_after timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz, UNIQUE(account_id, client_id), UNIQUE(account_id, id)
      );
      CREATE TABLE api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL,
        connection_id uuid NOT NULL, digest text NOT NULL UNIQUE, prefix text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(account_id, connection_id) REFERENCES connections(account_id, id) ON DELETE CASCADE
      );
      CREATE TABLE jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL, memory_id uuid NOT NULL,
        version integer NOT NULL, attempts integer NOT NULL DEFAULT 0,
        due_at timestamptz NOT NULL DEFAULT now(), lease_id uuid, lease_until timestamptz,
        failed_at timestamptz, error_code text,
        UNIQUE(account_id, memory_id, version),
        FOREIGN KEY(account_id, memory_id, version) REFERENCES memory_revisions ON DELETE CASCADE
      );
      CREATE INDEX jobs_due ON jobs(due_at) WHERE failed_at IS NULL;
      CREATE TABLE rate_buckets (
        account_id uuid NOT NULL REFERENCES accounts(id), minute timestamptz NOT NULL,
        count integer NOT NULL, PRIMARY KEY(account_id, minute)
      );
      CREATE TABLE deleted_memories (
        account_id uuid NOT NULL REFERENCES accounts(id), id uuid NOT NULL,
        deleted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id, id)
      );
      CREATE TABLE webhook_receipts (id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE session_revocations (id text PRIMARY KEY, revoked_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE subject_authority (subject text PRIMARY KEY, event_at bigint NOT NULL, deleted boolean NOT NULL DEFAULT false);
    `);

      for (const table of [
        "projects",
        "memories",
        "memory_revisions",
        "memory_embeddings",
        "memory_operations",
        "connections",
        "api_keys",
        "jobs",
        "rate_buckets",
        "deleted_memories",
      ]) {
        await db.raw(`ALTER TABLE ?? ENABLE ROW LEVEL SECURITY`, [table]);
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
      ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON accounts USING (id = NULLIF(current_setting('grove.account_id', true), '')::uuid);
      GRANT SELECT, UPDATE ON accounts TO grove_runtime, grove_worker;
      GRANT USAGE ON SCHEMA public TO grove_runtime, grove_worker;
      CREATE FUNCTION grove_account(subject text) RETURNS SETOF accounts
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(subject, 1));
        IF EXISTS(SELECT 1 FROM subject_authority WHERE subject_authority.subject = grove_account.subject AND deleted) THEN
          RETURN;
        END IF;
        INSERT INTO accounts(clerk_subject) VALUES(subject) ON CONFLICT(clerk_subject) DO NOTHING;
        RETURN QUERY SELECT * FROM accounts WHERE clerk_subject = subject;
      END $$;
      CREATE FUNCTION grove_key(key_id uuid, key_digest text) RETURNS TABLE(account_id uuid, connection_id uuid, clerk_subject text)
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
          SELECT k.account_id, k.connection_id, a.clerk_subject FROM api_keys k
          JOIN accounts a ON a.id = k.account_id JOIN connections c ON c.id = k.connection_id AND c.account_id = k.account_id
          WHERE k.id = key_id AND k.digest = key_digest AND a.status = 'active'
          AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())
      $$;
      CREATE FUNCTION grove_session_revoked(session_id text) RETURNS boolean
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT EXISTS(SELECT 1 FROM session_revocations WHERE id = session_id)
      $$;
      CREATE FUNCTION grove_webhook(event_id text, event_type text, subject text, event_at bigint) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      DECLARE owner_id uuid;
      BEGIN
        INSERT INTO webhook_receipts(id) VALUES(event_id) ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN RETURN; END IF;
        IF event_type IN ('session.revoked','session.ended','session.removed') THEN
          INSERT INTO session_revocations(id) VALUES(subject) ON CONFLICT DO NOTHING;
          RETURN;
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(subject, 1));
        IF event_type = 'user.deleted' THEN
          INSERT INTO subject_authority VALUES(subject, event_at, true)
            ON CONFLICT ON CONSTRAINT subject_authority_pkey DO UPDATE SET deleted = true;
          UPDATE accounts SET status = 'deleting', deleted_at = now(), provider_deleted_at = now()
            WHERE clerk_subject = subject AND status <> 'deleted' RETURNING id INTO owner_id;
          UPDATE connections SET revoked_at = now() WHERE account_id = owner_id;
        ELSIF event_type IN ('user.created','user.updated') THEN
          INSERT INTO subject_authority VALUES(subject, event_at, false)
            ON CONFLICT ON CONSTRAINT subject_authority_pkey DO UPDATE SET event_at = EXCLUDED.event_at
              WHERE subject_authority.event_at < EXCLUDED.event_at AND NOT subject_authority.deleted;
        END IF;
      END $$;
      CREATE FUNCTION grove_claim_job() RETURNS SETOF jobs
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        UPDATE jobs SET lease_id = gen_random_uuid(), lease_until = now() + interval '120 seconds', attempts = attempts + 1
          WHERE id = (SELECT j.id FROM jobs j JOIN accounts a ON a.id = j.account_id
            WHERE a.status = 'active' AND j.failed_at IS NULL AND j.due_at <= now()
            AND (j.lease_until IS NULL OR j.lease_until < now()) ORDER BY j.due_at
            FOR UPDATE OF j SKIP LOCKED LIMIT 1) RETURNING *
      $$;
      CREATE FUNCTION grove_maintenance_accounts() RETURNS TABLE(id uuid, status text, clerk_subject text, provider_deleted_at timestamptz)
        LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT a.id, a.status, a.clerk_subject, a.provider_deleted_at FROM accounts a
        WHERE a.status = 'deleting' OR EXISTS(SELECT 1 FROM memories m WHERE m.account_id = a.id AND m.purge_at <= now())
        ORDER BY a.id LIMIT 100
      $$;
      REVOKE ALL ON FUNCTION grove_account(text), grove_key(uuid,text), grove_session_revoked(text), grove_webhook(text,text,text,bigint), grove_claim_job(), grove_maintenance_accounts() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_account(text), grove_key(uuid,text), grove_session_revoked(text), grove_webhook(text,text,text,bigint) TO grove_runtime;
      GRANT EXECUTE ON FUNCTION grove_claim_job(), grove_maintenance_accounts() TO grove_worker;
    `);
    },
    async down() {
      throw new Error(
        "Use a forward migration; rolling back would erase memory data",
      );
    },
  },
  hardening,
  identityState,
  {
    name: "20261019_004_connection_setup",
    async up(db: Knex) {
      // One bounded, replaceable attempt per existing RLS-protected connection.
      await db.raw("ALTER TABLE connections ADD COLUMN setup jsonb");
      await db.raw(
        "CREATE INDEX connections_setup_id ON connections ((setup->>'id')) WHERE setup IS NOT NULL",
      );
    },
    async down() {
      throw new Error("Use a forward migration");
    },
  },
  modelProviders,
  memoryLifetimes,
  backgroundServices,
  nestedNotebooks,
  conversations,
  relationships,
  publicSharing,
  shareExpiration,
  aiPreferences,
  queueProcessing,
  notebookAssistance,
  notebookLifecycle,
  mediaAttachments,
  recordings,
  speech,
  researchTools,
  speechDefaults,
  speechVoices,
  billing,
  speechCache,
  systemAdministration,
  speechDuration,
  adminSupport,
];

export const migrationSource: Knex.MigrationSource<
  (typeof migrations)[number]
> = {
  getMigrations: async () => migrations,
  getMigrationName: (migration) => migration.name,
  getMigration: async (migration) => migration,
};
