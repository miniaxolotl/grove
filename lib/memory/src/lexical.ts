import {
  camelRows,
  type Knex,
  type MemoryModel,
  type QueryBuilder,
} from "@lib/database";
import type { Embedder, Providers } from "@lib/ai";
import type { AccountPreferences } from "@lib/shared/preferences";
import { searchExpansion } from "@lib/shared/search";

export type SearchRow = MemoryModel & {
  searchTitle: string;
  searchTier: number;
  searchScore: number;
};
export const searchVersion = "title-prefix-trgm-shortfall40-v1";

/** One eligible relation for every lane. Never elevate privileges for search. */
export function lexicalQuery(
  trx: Knex.Transaction,
  eligible: QueryBuilder<MemoryModel>,
  query: string,
  providers: Providers,
  account: AccountPreferences,
  semantic?: { embedder: Embedder; vector: number[] },
) {
  const expansion = searchExpansion(query);
  const profile = account.titlesTagsEnabled
    ? providers.generation?.profile
    : undefined;
  const titled = eligible.clone().clearOrder();
  if (!titled.hasSelects()) titled.select("memories.*");
  titled.select(
    trx.raw(
      `grove_search_title(memories.content, CASE WHEN memories.status='active'
      AND (memories.expires_at IS NULL OR memories.expires_at>now()) THEN
      (SELECT e.data->>'title' FROM memory_enrichments e
        WHERE e.account_id=memories.account_id AND e.memory_id=memories.id
        AND e.version=memories.version AND e.kind='organization' AND e.profile=?) END) AS search_title`,
      [profile ?? null],
    ),
  );
  const q = trx
    .withMaterialized("titled", titled.toKnexQuery())
    .withMaterialized("flags", (b) =>
      b
        .select(
          "titled.*",
          "qs.strict_query",
          "qs.prefix_query",
          trx.raw("to_tsvector('english',search_title) AS title_vector"),
          trx.raw("search @@ strict_query AS body_strict"),
          trx.raw(
            "to_tsvector('english',search_title) @@ strict_query AS title_strict",
          ),
          trx.raw("search @@ prefix_query AS body_prefix"),
          trx.raw(
            "to_tsvector('english',search_title) @@ prefix_query AS title_prefix",
          ),
        )
        .from("titled")
        .crossJoin(
          trx.raw(
            "(SELECT websearch_to_tsquery('english',?) AS strict_query, to_tsquery('english',?) AS prefix_query) qs",
            [query, expansion?.prefix ?? ""],
          ),
        ),
    );
  const fuzzy = (document: string) => {
    if (!expansion || !expansion.tokens.some((t) => t.length >= 4))
      return trx.raw("false");
    const clauses = expansion.tokens.map((token, i) => {
      const term = trx.raw(
        `(numnode(plainto_tsquery('english',?))=0 OR ${document} @@ plainto_tsquery('english',?)
        ${i === expansion.tokens.length - 1 && expansion.prefix ? `OR ${document} @@ to_tsquery('english',?)` : ""}
        ${token.length >= 4 ? `OR ? <% ${document === "search" ? "content" : "search_title"}` : ""})`,
        [
          token,
          token,
          ...(i === expansion.tokens.length - 1 && expansion.prefix
            ? [`${token}:*`]
            : []),
          ...(token.length >= 4 ? [token] : []),
        ],
      );
      return term;
    });
    return trx.raw(
      `(numnode(strict_query)>0 AND ${clauses.map(() => "?").join(" AND ")})`,
      clauses,
    );
  };
  // Count against the complete eligible set, never against a cursor/page and
  // never against semantic neighbors. Avoid fuzzy work on adequately covered queries.
  q.with("capacity", (b) =>
    b.select(
      trx.raw(
        `EXISTS(SELECT 1 FROM flags
    WHERE body_strict OR body_prefix OR (? AND (title_strict OR title_prefix))
    OFFSET 39 LIMIT 1) AS lexical_capacity`,
        [!!expansion],
      ),
    ),
  );
  q.withMaterialized("classified", (b) =>
    b
      .from("flags")
      .crossJoin(trx.raw("capacity"))
      .select(
        "flags.*",
        trx.raw(
          `CASE WHEN title_strict AND (? OR body_strict) THEN 0
      WHEN title_prefix AND ? THEN 1 WHEN body_strict THEN 2
      WHEN body_prefix THEN 3 WHEN NOT lexical_capacity AND ? THEN 4
      WHEN NOT lexical_capacity AND ? THEN 5 ELSE 6 END AS search_tier`,
          [!!expansion, !!expansion, fuzzy("title_vector"), fuzzy("search")],
        ),
      ),
  );
  const similarity = (document: string) =>
    expansion
      ? trx.raw(
          `least(${expansion.tokens.map(() => "CASE WHEN numnode(plainto_tsquery('english',?))=0 THEN 1 ELSE word_similarity(?,??) END").join(",")})`,
          expansion.tokens.flatMap((token) => [token, token, document]),
        )
      : trx.raw("0");
  const result = q
    .from("classified")
    .select(
      "classified.*",
      trx.raw(
        `CASE WHEN search_tier<4 THEN greatest(ts_rank_cd(search,strict_query),ts_rank_cd(title_vector,strict_query),
      ts_rank_cd(search,prefix_query),ts_rank_cd(title_vector,prefix_query))
      WHEN search_tier=4 THEN ? WHEN search_tier=5 THEN ? ELSE 0 END::double precision AS search_score`,
        [similarity("search_title"), similarity("content")],
      ),
    )
    .where((b) => {
      b.where("search_tier", "<", 6);
      if (semantic)
        b.orWhereRaw(
          `EXISTS(SELECT 1 FROM memory_embeddings e WHERE e.account_id=classified.account_id
      AND e.memory_id=classified.id AND e.version=classified.version AND CASE WHEN e.profile=?
      THEN (e.embedding <=> ?::vector) < ? ELSE false END)`,
          [
            semantic.embedder.profile,
            JSON.stringify(semantic.vector),
            semantic.embedder.distanceThreshold ?? 0.45,
          ],
        );
    });
  if (!semantic)
    result.whereRaw("numnode(websearch_to_tsquery('english',?))>0", [query]);
  return result;
}

export async function lexicalMatches(
  trx: Knex.Transaction,
  eligible: QueryBuilder<MemoryModel>,
  query: string,
  providers: Providers,
  account: AccountPreferences,
  limit: number,
) {
  // A transaction-local threshold, never a global setting or per-branch action.
  await trx.raw(
    "SELECT set_config('pg_trgm.word_similarity_threshold',?,true)",
    ["0.6"],
  );
  return (await lexicalQuery(trx, eligible, query, providers, account)
    .orderBy("search_tier")
    .orderBy("search_score", "desc")
    .orderBy("id")
    .limit(limit)) as SearchRow[];
}

export type SearchPosition = { tier: number; score: number; id: string };

/** Fingerprint and page share one PostgreSQL statement/snapshot. It also detects
 * asynchronous title/vector changes without adding per-row write-side counters. */
export async function relevancePage(
  trx: Knex.Transaction,
  query: Knex.QueryBuilder,
  limit: number,
  after?: SearchPosition,
) {
  const statement = trx.withMaterialized("hits", query).select(
    trx.raw(`(SELECT md5(coalesce(string_agg(md5(jsonb_build_array(id,version,
      content,search_title,search_tier,search_score,updated_at)::text),'' ORDER BY id),'')) FROM hits) AS fingerprint`),
    trx.raw(
      `COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM (SELECT * FROM hits
      ${after ? "WHERE (search_tier,-search_score,id) > (?,?::double precision,?::uuid)" : ""}
      ORDER BY search_tier,search_score DESC,id LIMIT ?) page),'[]'::jsonb) AS items`,
      [...(after ? [after.tier, -after.score, after.id] : []), limit + 1],
    ),
  );
  const [value] = await statement;
  return {
    fingerprint: value.fingerprint as string,
    rows: camelRows<SearchRow>({ rows: value.items }),
  };
}
