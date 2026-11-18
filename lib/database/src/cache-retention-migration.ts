import type { Knex } from "knex";

export const cacheRetention = {
  name: "20261118_043_cache_retention",
  async up(db: Knex) {
    const { rows } = await db.raw(
      "SELECT pg_get_functiondef('grove_schedule_cleanup()'::regprocedure) AS definition",
    );
    const definition: string = rows[0].definition;
    const anchor = "OR EXISTS(SELECT 1 FROM rate_buckets r";
    if (definition.split(anchor).length !== 2)
      throw new Error("Unsupported retention scheduler baseline");
    await db.raw(
      definition.replace(
        anchor,
        `OR EXISTS(SELECT 1 FROM ai_cache c WHERE c.account_id=a.id AND c.expires_at<=now())
            OR EXISTS(SELECT 1 FROM ai_provider_backoff b WHERE b.account_id=a.id AND b.retry_at<now()-interval '1 day')
            ${anchor}`,
      ),
    );
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
