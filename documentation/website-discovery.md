# Public reference discovery

`/docs` and its five allowlisted reference pages render the committed product
documentation at build time. `packages/website/src/content/documentation.ts` is the
public manifest for navigation, sitemap coverage, metadata and source filenames.
`client.md`, `server.md`, `models.md`, `ask-tools.md` and `hosted-chat.md` remain the
only body sources: edit them rather than creating a second website copy.

The loader reads only manifest filenames from the repository's `documentation/`
directory while Next builds from `packages/website`. Static parameters enumerate
all public documents; unknown slugs are 404. Missing source files fail the build.
No account data, directory listing, arbitrary filesystem route or runtime GitHub
fetch is introduced. Marketing and authenticated application layouts stay separate.

React Markdown renders CommonMark/GFM without raw HTML; the existing parser is
reused and a pinned server-side heading-slug plugin preserves fragment navigation.
Approved relative Markdown links resolve to own-domain pages. Other repository
references remain explicit production GitHub links, not speculative public routes.
Commands and tables scroll locally with keyboard focus rather than widening phones.
Document pages are matched to the website source, not every separately installed
client or self-hosted runtime. Existing beta/provider qualification limits remain.

## Verification and maintenance

The discovery browser suite first reproduced missing public routes and missing
internal links. It checks no-JavaScript HTML, a single heading/canonical, descriptions,
sitemap inclusion, relative/fragment links, invalid slugs, private-path exclusion and
320/390/768/1440px overflow. Existing website and artifact suites remain required.
Review source document headings, links, setup commands and actual current product
contracts when changing the manifest; do not hardcode stale tool counts.

See [reviewed captures](design/screenshots/discovery/README.md). Their browser source
is a local production build, not hosted qualification or a production release.

The audit's client-dependent Cloudflare 403 is not proof of Googlebot blocking.
Verify authentic crawler events and owner URL tests before any edge-policy change.
This work changes no WAF, bots, training preferences, telemetry allowlists, billing,
OAuth grants, private routes, migrations or production configuration. Do not expand
public indexing into `/app`, `/api`, auth or `/s/` to increase coverage.

After a separately authorized rollout, verify the deployed source and public route
inventory. Use owner Search Console/Bing diagnostics for actual index coverage;
measure search traffic, observable AI citations/referrals and conversions separately.
No `llms.txt`, structured-data or parser choice guarantees ranking or citation.
