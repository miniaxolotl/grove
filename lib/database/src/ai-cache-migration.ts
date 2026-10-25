import type { Knex } from "knex";

export const aiCache = {
  name: "20261025_033_ai_cache",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE action_usage ADD COLUMN units smallint NOT NULL DEFAULT 5 CHECK(units IN (1,5));
      ALTER TABLE conversation_turns ADD COLUMN refresh_sources boolean NOT NULL DEFAULT false;
      CREATE TABLE ai_cache (
        account_id uuid NOT NULL REFERENCES accounts(id),
        feature text NOT NULL CHECK(feature IN ('query_embedding','document_embedding','organization','classification','planning','answer','research')),
        key text NOT NULL CHECK(length(key)=64), epoch bigint NOT NULL,
        lease_id uuid NOT NULL, lease_until timestamptz NOT NULL, refresh_id uuid,
        value jsonb, expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(account_id,feature,key),
        CHECK(value IS NULL OR octet_length(value::text)<=262144)
      );
      CREATE INDEX ai_cache_retention ON ai_cache(account_id,created_at);
      CREATE TABLE ai_provider_backoff (
        account_id uuid NOT NULL REFERENCES accounts(id), profile text NOT NULL,
        retry_at timestamptz NOT NULL, probe_id uuid NOT NULL, probing boolean NOT NULL DEFAULT false,
        epoch bigint NOT NULL, PRIMARY KEY(account_id,profile)
      );
      ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ai_cache FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON ai_cache
        USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE,DELETE ON ai_cache TO grove_runtime,grove_worker;
      ALTER TABLE ai_provider_backoff ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ai_provider_backoff FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON ai_provider_backoff
        USING(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK(account_id=NULLIF(current_setting('grove.account_id',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE,DELETE ON ai_provider_backoff TO grove_runtime,grove_worker;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
