import type { Knex } from "knex";

export const proofingConsents = {
  name: "20261118_044_proofing_consent",
  async up(db: Knex) {
    await db.raw(`CREATE TABLE proofing_consents (
      account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      scope text NOT NULL CHECK(scope='grove-note-editor'),
      version integer NOT NULL CHECK(version>0),
      generation uuid NOT NULL,
      automatic boolean NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      CHECK(revoked_at IS NULL OR NOT automatic),
      PRIMARY KEY(account_id,scope)
    );
    ALTER TABLE proofing_consents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE proofing_consents FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant ON proofing_consents USING(account_id=nullif(current_setting('grove.account_id',true),'')::uuid);
    GRANT SELECT, INSERT, UPDATE ON proofing_consents TO grove_runtime;
    GRANT SELECT, DELETE ON proofing_consents TO grove_worker;`);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
