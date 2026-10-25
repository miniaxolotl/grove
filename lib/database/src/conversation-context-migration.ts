import type { Knex } from "knex";

export const conversationContext = {
  name: "20261025_029_conversation_context",
  async up(db: Knex) {
    await db.raw("ALTER TABLE conversation_turns ADD COLUMN context jsonb");
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
