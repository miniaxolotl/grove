import type { Knex } from "knex";

export const speechVoices = {
  name: "20261024_022_speech_voices",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN read_aloud_voice_id text NOT NULL DEFAULT 'reed'
        CHECK (read_aloud_voice_id IN ('reed','willow','cedar','brook'));
      ALTER TABLE speech_configuration ADD COLUMN synthesis_profiles jsonb NOT NULL DEFAULT '{}'
        CHECK (jsonb_typeof(synthesis_profiles) = 'object');
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
