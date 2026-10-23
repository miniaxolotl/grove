import type { Knex } from "knex";

export const researchTools = {
  name: "20261023_020_ask_tools",
  async up(db: Knex) {
    await db.raw(`
      ALTER TABLE accounts ADD COLUMN ask_tools jsonb NOT NULL DEFAULT '{"exa":true,"tavily":false,"organize":true}';
      ALTER TABLE conversations ADD COLUMN tools jsonb NOT NULL DEFAULT '{"exa":true,"tavily":false,"organize":true}',
        ADD COLUMN tools_version integer NOT NULL DEFAULT 0;
      ALTER TABLE conversation_turns ADD COLUMN tool_runs jsonb NOT NULL DEFAULT '[]';
      CREATE TABLE research_account_usage (
        account_id uuid NOT NULL REFERENCES accounts(id), day date NOT NULL,
        calls integer NOT NULL DEFAULT 0, PRIMARY KEY(account_id,day)
      );
      ALTER TABLE research_account_usage ENABLE ROW LEVEL SECURITY;
      ALTER TABLE research_account_usage FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON research_account_usage USING (account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid)
        WITH CHECK (account_id = NULLIF(current_setting('grove.account_id',true),'')::uuid);
      GRANT SELECT, DELETE ON research_account_usage TO grove_runtime, grove_worker;
      CREATE TABLE research_global_usage (month date PRIMARY KEY, microdollars bigint NOT NULL DEFAULT 0);
      REVOKE ALL ON research_global_usage FROM PUBLIC, grove_runtime, grove_worker;
      CREATE FUNCTION grove_research_reserve(provider text, operation text, daily_limit integer, monthly_limit bigint)
        RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      DECLARE account uuid := NULLIF(current_setting('grove.account_id',true),'')::uuid;
        charge bigint; used integer; period date := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
        today date := (now() AT TIME ZONE 'UTC')::date;
      BEGIN
        IF account IS NULL OR daily_limit < 1 OR monthly_limit < 1 OR
          NOT EXISTS(SELECT 1 FROM public.accounts WHERE id=account AND status='active' AND ask_enabled) THEN RETURN false; END IF;
        charge := CASE WHEN provider='exa' AND operation='search' THEN 4000
          WHEN provider='exa' AND operation='extract' THEN 3000
          WHEN provider='tavily' AND operation IN ('search','extract') THEN 8000 ELSE NULL END;
        IF charge IS NULL THEN RETURN false; END IF;
        INSERT INTO public.research_account_usage(account_id,day) VALUES(account,today) ON CONFLICT DO NOTHING;
        SELECT calls INTO used FROM public.research_account_usage WHERE account_id=account AND day=today FOR UPDATE;
        IF used >= daily_limit THEN RETURN false; END IF;
        INSERT INTO public.research_global_usage(month) VALUES(period) ON CONFLICT DO NOTHING;
        UPDATE public.research_global_usage SET microdollars=microdollars+charge
          WHERE month=period AND microdollars+charge<=monthly_limit;
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE public.research_account_usage SET calls=calls+1 WHERE account_id=account AND day=today;
        RETURN true;
      END $$;
      REVOKE ALL ON FUNCTION grove_research_reserve(text,text,integer,bigint) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION grove_research_reserve(text,text,integer,bigint) TO grove_runtime;
    `);
  },
  async down() {
    throw new Error("Use a forward migration");
  },
};
