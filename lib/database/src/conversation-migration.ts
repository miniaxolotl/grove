import type { Knex } from "knex";

export const conversations = {
  name: "20261020_009_conversations",
  async up(db: Knex) {
    await db.raw(`
      CREATE TABLE conversations (
        id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
        title text NOT NULL DEFAULT 'New conversation', scope jsonb NOT NULL,
        version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(account_id, id)
      );
      CREATE INDEX conversations_recent ON conversations(account_id, updated_at DESC, id DESC);
      CREATE TABLE deleted_conversations (
        account_id uuid NOT NULL REFERENCES accounts(id), id uuid NOT NULL,
        deleted_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id, id)
      );
      CREATE TABLE conversation_turns (
        id uuid PRIMARY KEY, account_id uuid NOT NULL, conversation_id uuid NOT NULL,
        position integer NOT NULL CHECK (position > 0), question text NOT NULL,
        format text NOT NULL DEFAULT 'plain' CHECK (format IN ('plain','markdown')),
        fingerprint text NOT NULL, status text NOT NULL CHECK (status IN ('pending','ready','failed')),
        result jsonb, undo jsonb, error text, lease_id uuid, lease_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(account_id, conversation_id, position),
        FOREIGN KEY(account_id, conversation_id) REFERENCES conversations(account_id, id) ON DELETE CASCADE
      );
    `);
    for (const table of [
      "conversations",
      "conversation_turns",
      "deleted_conversations",
    ]) {
      await db.raw("ALTER TABLE ?? ENABLE ROW LEVEL SECURITY", [table]);
      await db.raw("ALTER TABLE ?? FORCE ROW LEVEL SECURITY", [table]);
      await db.raw(
        `CREATE POLICY tenant ON ?? USING (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid) WITH CHECK (account_id = NULLIF(current_setting('grove.account_id', true), '')::uuid)`,
        [table],
      );
      await db.raw(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ?? TO grove_runtime, grove_worker",
        [table],
      );
    }
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
