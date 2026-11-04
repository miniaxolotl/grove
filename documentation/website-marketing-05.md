# Website product presentation

The public site explains Grove as a private notebook with semantic search,
source-linked Ask answers and optional agent context. Notebook signup is the
primary action. Interactive examples demonstrate notes, journal/graph views and
answers; all use labelled sample content and perform no account writes.

The opening notebook presents the saved note and its cited answer together at
readable size. The separate Ask comparison demonstrates the effect of saved
context. Onboarding explains actual setup instead of repeating a third note and
answer example. Feature descriptions are owned by their demonstration or feature
section, not repeated throughout the page.

Library views explain nested notebooks, semantic/keyword search and assistance
previews. The feature index adds short voice recording/transcription, read aloud,
import/sharing, revision history, export and scoped agent access.
Reverted Workbench/meeting-preparation workflows are not advertised.
Existing cloud/self-hosted setup and private workspace routes are preserved.

`/pricing` is a public, server-rendered page linked from navigation, footer,
homepage and sitemap. It reads standard allowances from `@lib/shared/billing`
and the same monthly-price flag as the billing UI. Purchases still require the
existing configuration/feature gate; when off, the page explains that upgrades
are unavailable and links to signup instead. It does not call Stripe, enable
billing, promise an annual discount or create a checkout session. Prices shown
before a purchase are informational; the account and checkout remain authoritative.
See [billing](billing.md) for reset, cache, provider-budget and downgrade rules.

The four product sites share a public-site system: plain navigation,
single-face headings, filled product surfaces, readable feature lists and
responsive actions. “A home for your notes” sits beside the light working notebook
on paper, refining the live site's split introduction rather than replacing it.
The notebook has a sample selector, complete note and source-linked answer. Weekend,
newsletter and journal selectors switch the complete note, question and answer;
each source link returns to its note. The working columns stack on phones. The lower
library and Ask examples use concrete travel, dinner, garden and journal details.
Space Grotesk stays precise and calm; flat surfaces separate the reading areas. The
compact footer uses the approved outlined Grove signature without a separate
giant-name row. Fine-pointer header/primary actions are 36px/38px, with 44px coarse-pointer targets,
an 80px desktop / 72px phone header and a 1280px content frame.
Existing marks and local fonts remain.
Styles stay under the marketing layout; the authenticated workspace is not redesigned.
The owning kit guide is `marketing/guidelines/grove.md`, generated from
`marketing/_source/website-guidelines.mjs`. Its 4 November website rules specify
Space Grotesk 500 headings, optical tracking, natural two-line
breaks, readable notebook demonstrations and signup-first actions. Footer top padding is
40px desktop / 32px phone, with the proportional approved signature at up to
280px / 220px. Pricing stays sourced from shared limits and existing flags.
The website owns its CSS/assets and does not import the sibling kit at runtime.
The journal photograph comes from the marketing kit's existing master; its local
WebP manifest retains source/output hashes, dimensions and licence. It is
illustrative photography, not a customer's notebook.
Research: [Linear](https://linear.app), [Craft](https://www.craft.do),
[Things](https://culturedcode.com/things/), [Retro](https://retro.app),
[Raycast](https://www.raycast.com) and [Panic](https://panic.com).
Principles were adapted; no reference assets,
testimonials or statistics were copied.

The owner-selected references [Evernote](https://evernote.com/) and
[Obsidian](https://obsidian.md/) inform the clear notebook proposition, substantial
product view and task-led information hierarchy. Grove keeps its own identity,
examples, browser-first setup and pricing. It does not inherit the references'
local-first, offline, encryption, collaboration or plugin claims.

## Realistic, isolated examples

The public library opens on the app's real graph canvas, node/edge components and
deterministic force layout. Eight local sample notes form two connected groups;
selection, linked-note inspection, panning, zoom and title controls work without
account API calls. The public wrapper does not mount the private graph container
or its connection queries. The app's renderer is re-exported without changing
authenticated behavior. The graph is a labelled fixture, not customer evidence.

Notebook, library, Ask and answer-comparison samples reserve their largest
intrinsic state in shared grid tracks. Inactive panels remain mounted but are
inert and hidden from assistive technology. There are no selection-driven height
measurements, clipped answers or remount keys. Four-width public stability tests
also verify graph keyboard selection, contrast and absence of account requests.

## Setup and public documentation

`/docs/notebook` publishes the maintained [workspace guide](workspace.md) through
the existing allowlist. It takes a browser user from account creation to a saved
note and checked citation, followed by writing, sharing and recovery reference.
`/install` remains the separate guided connection path. It distinguishes browser
approval, client-specific activation and a fresh-session save/recall check; API
access alone is not host verification. The [client guide](client.md) owns exact
commands, grants, revocation and diagnosis, rather than copying the reference
into the marketing page.

See [reviewed desktop/phone home and pricing screenshots](design/screenshots/product-redesign/README.md).
Build and browser checks use local source/fixtures, not payment/provider or
production acceptance. Publication still follows protected release promotion.

## Public discovery

Public routes use initial-HTML metadata, route-specific canonical/sharing URLs
and approved 1200 × 628 social PNGs. `/llms.txt` exposes only public product facts
and documentation links and is advertised in the document head. It is an emerging
supplement, not an AI-ingestion or citation guarantee. Preview/development and
`SITE_NOINDEX=true` serve noindex, disallow-all robots rules and an empty sitemap.
Private app, account and shared-note URLs remain excluded; robots is not access
control. Public styling stays scoped away from the authenticated workspace.

## Historical Collection 05 material

The website leads with a private notebook that makes saved notes easy to find.
The main action is notebook signup. The developer section explains saved context
across coding sessions and links to agent setup.

Current support/contact routes and designated public email are documented in
[Website support and contact](website-support-contact.md). Earlier verification
counts below are historical, not the current browser-suite totals.

## Copy follow-up

The 21 October follow-up simplifies headings, FAQs, sharing feedback, footer,
account-entry and installation copy. Public pages no longer promote brand
materials or downloads. Notebook and agent demonstrations retain their example
labels. The primary action remains notebook signup.

Root lint/types/build and five artifact checks pass. The 68 browser scenarios
pass across the initial run and the corrected copy-expectation rerun; all ten
marketing cases pass on the final build. Website lint/types/build, 12 release
contracts and workflow lint pass. Public-page reviews at 320/390/768/1440px
include installation, self-hosting, account entry, legal and missing pages, with
no overflow, accessibility violations or browser errors.

## Assets

- Search and journal graphics use Collection 05 notebook artwork.
- The interactive notebook and Ask Grove previews demonstrate the supported tasks.
- The approved Sprout mark and Space Grotesk/JetBrains Mono typography remain.
- Share metadata, the brand page, product description and media kit are refreshed.
- `packages/website/public/materials/manifest.json` records sources and hashes.
- The media kit includes logos, fonts, licenses, illustrations and product copy.

Exports come from `marketing/_source/export-websites-05.mjs` in the local dataset,
using `artwork.mjs`, `grove-notebook-art.mjs`, `current-campaigns.mjs` and the design
guidelines. Graphics are labeled as illustrated examples with sample notes.

## Review

Copy uses short, direct language and standard punctuation. Existing browser checks
cover signup links, keyboard previews, agent installation, accessibility, sharing,
telemetry privacy and the private workspace. Only the changed empty-preview text
and setup-heading expectations are updated.

Verified 21 October 2026: website lint/types/build, the 68-case browser suite
(including the corrected copy assertion), root lint/types/build, five packed
artifact tests, 12 release contracts and workflow lint pass. The ten marketing
browser cases pass again after the final copy edits. Additional reviews at
320, 390, 768 and 1440px pass accessibility, overflow, image and download checks.
Identity hashes, font licenses and media-kit archive contents verify.

Publication follows `deploy.md` through protected development, Release Please
and the selected frozen production candidate.
