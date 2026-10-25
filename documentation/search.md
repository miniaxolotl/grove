# Note search

Global search (`Ctrl`/`Cmd` + `K`), the library, Ask Grove's Search tab and
connected-agent recall share lexical matching. It works without an AI provider;
semantic retrieval remains an additional scoped lane. Existing AI allowances
and keyword fallback are unchanged.

## Matching and relevance

Relevance orders full-query title matches, title prefixes, body matches, body
prefixes, title typos, body typos, then semantic-only matches. Repeated body
words or semantic/salience scores cannot override a higher category. Scores and
stable note IDs break ties within categories.

Full-query title matches are evaluated separately from body matches. The body
includes an authored heading but does not concatenate generated-title text into
the source body; a query split only across a generated title and the body is not
a new supported match mode in this version.

The title is the opening Markdown heading, otherwise the currently visible
generated title, otherwise the opening line. Disabled, stale-revision and old
provider titles cannot retrieve notes. Authored titles keep a 110 UTF-16-unit
limit without splitting emoji; generated titles retain their existing limit.
`Untitled note` is not indexed as authored evidence.

For plain positive queries, the **last term** can be a prefix: `garden des`
finds `garden design`. Earlier terms keep ordinary English full-text semantics.
Exact/stemmed matches outrank prefixes within the same field.

When fewer than **40 lexical/prefix matches** exist in the full authorized
scope, `pg_trgm` adds conservative typo candidates, independently of semantic
success. Every positive term must match; `design` alone does not satisfy
`gardn design`. Only terms of at least four characters are fuzzed, with a
transaction-local word-similarity threshold of **0.6**. This is not arbitrary
edit-distance matching: deletions such as `gardn` and `databse` work, while
short transpositions such as `form`/`from` or `desgin`/`design` may not.

Quoted phrases, `OR`, exclusions (`garden -cooking`) and unusual/oversized input
retain the strict PostgreSQL parser, without typo/prefix expansion. Advanced
syntax keeps the body predicate authoritative: titles cannot bypass exclusions;
advanced-syntax title-only expansion is deferred. English stemming/stop words
remain: `runs` can match `running`, but `the` does not autocomplete `therapy`.
No accent folding/language detection is added. Expansion is bounded to 16 tokens
of at most 64 UTF-16 units each; the full accepted query still reaches strict
parsing when expansion is disabled.

Entering a library query selects Relevance unless you deliberately chose a date
sort. Explicit date sorts stay global; clearing restores the prior non-query
sort. No-query listing and Date written retain their existing behavior.

## Evidence and passages

Responses can include an optional `matches` map separate from canonical notes,
keyed by note ID. Entries carry `query`, `version`, `kind`, and `title`/`snippet`
objects with plain `text` and `[start,end)` UTF-16 `ranges`. Existing
`searchMode` values are unchanged.

The API generates bounded passages after selection with PostgreSQL stem/prefix
evidence. Clients render escaped text/ranges, **never headline HTML**. Marks
require the current query and version; title marks also require the displayed
title to match. Typo and semantic-only hits use ordinary unmarked excerpts in
this first version, rather than invented near-word highlights. Older servers/
clients retain the literal snippet fallback. Canonical reads, exports and note
content are unchanged. Recall counts evidence against its existing character
budget and may omit an entire note that does not fit; it never truncates the
authoritative source body.

## Pagination, privacy and operation

`listSchema.sort` accepts `relevance`; query searches without a sort also use it.
Existing explicit date-sort paths remain compatible. Signed relevance cursors
bind account/grant, filters, provider/title configuration, parser version, search
mode and rank position. A complete matched-set fingerprint and page are computed
in **one SQL statement**. Notes created after the first-page ceiling are excluded
from that traversal; changes to eligible existing notes or visible asynchronous
titles require a restart (`stale_search`, HTTP 409).

Keyword fallback remains keyword-only across allowance upgrades/provider recovery.
A changed hybrid query vector cannot silently change ordering. The workspace
offers Refresh search results instead of repeatedly fetching a stale page.
Queries stay in POST bodies and query-scoped evidence stays in private memory;
note edits/deletion and account/session boundaries invalidate it.

Every branch uses the same non-owner RLS, grant, notebook and lifecycle filters.
Recall is active-only; the library honors archive/expiry filters. Relationship
discovery/public sharing retain their existing body vector and behavior. No
cross-account vocabulary, elevated search role or retained deletion is added.

The forward migration installs `pg_trgm` and an invoker-only immutable title
resolver; it leaves the existing vector/index unchanged. Readiness fails on
missing prerequisites. There is no new content-trigram index: owner GIN use
does not prove runtime use for non-leakproof operators behind RLS. Relevance
fingerprinting and typo shortfalls scan the eligible scope; `LIMIT` alone does
not cap that work. Measure real runtime plans, never weaken RLS to force an index.
See [rollout](deploy.md#search-quality-rollout) and
[verification](development/testing.md#search-quality).
