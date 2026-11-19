# Website product presentation

The public site explains Grove as an AI notebook for study and thoughtful work:
notes, readings, short recordings and source-linked Ask answers. Agent context is
optional. Notebook signup is the primary action. Interactive examples demonstrate
notes, journal/graph views and answers; all use labelled sample content and perform
no account writes.

The homepage introduces the product in plain text next to one interactive
notebook with cited answers. **Get started** links to extension and AI tool setup
and to [Notebook examples](https://grovenote.app/examples), where visitors can
try the separate library and Ask examples without signing in. The homepage keeps
signup, the feature list, pricing and FAQ without repeating the setup steps.
It uses the approved Space Grotesk family and does not wait for scroll-triggered
reveals. The opening reads “Your AI notebook”; its default sample is a seminar
note, not a claim that a dedicated study mode or flashcard feature is available.

Library examples show nested notebooks and semantic/keyword search. The homepage
feature list groups saving notes/PDFs/short recordings, transcription/read-aloud,
revision comparisons, sharing and export. Browser extension and scoped AI-client
setup remain separate links under Get started.
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

The homepage's two columns stack on phones. Seminar, weekend, newsletter and journal
selectors switch the complete note, question and answer; each citation returns
to its note. The layout uses flat surfaces and keeps the approved Grove marks.
The expanded library and Ask examples use labelled sample content, not account
data. The authenticated workspace retains its existing system interface font,
sidebar, note editor and settings navigation.

The former revision-review screenshot is replaced by **Notes / Transcript /
Listen**, a browser-only sample tool. Visitors can edit and reset a bounded
sample draft, inspect a prepared transcript, and explicitly play the original
sample with an available on-device English browser voice. Edits never update the
prepared answers or audio, are not saved, and do not reach Grove APIs. No
microphone, file upload or AI provider runs from this demo. Voice availability
varies; unavailable/error states keep the text readable. This is not acceptance
of Grove's production transcription or speech providers. Actual recording limits
remain in [recordings](recordings.md), and read-aloud in [speech](speech.md).

Public pages share the family’s neutral paper/white surfaces, readable legal
text, consistent focus treatment and restrained secondary-page headings.
The marketing and account-entry layouts load the existing licensed Space Grotesk
400/500/600/700 WOFF2 files with `next/font/local`; no external font service is
called. Each layout scopes `--font-public-sans` and `--font-interface` to its own
wrapper, leaving the root system-font default and authenticated workspace alone.
At widths below 360px, Your Grove remains a visible, keyboard-accessible account
icon with its explicit accessible name. It does not shrink the approved header
signature or crowd the menu control.
Public headings, prices and links use supplied weights rather than intermediate
weight requests. Code keeps its existing JetBrains Mono treatment.

Sign-in, sign-up and nested Clerk recovery steps retain support/privacy/terms links in
their surrounding layout, including when the provider is unavailable. Public
auth entry deliberately stays light in either OS scheme, matching the marketing
site; provider security notices and validation remain intact.

See the [family-polish review](design/screenshots/marketing-family-polish/README.md).
Research direction: professional learning and source inspection, informed by
[NotebookLM](https://support.google.com/notebooklm/answer/16179559?hl=en),
[Notion](https://www.notion.com/help/notion-agent) and
[Granola](https://docs.granola.ai/help-center/taking-notes/ai-enhanced-notes).
Audience/message ideas are hypotheses to test, not customer-demand evidence.

The website owns its CSS and assets and does not import the sibling kit at
runtime. Share artwork and adaptive SVG, ICO and PNG favicons are tracked in
`packages/website/public/marketing-kit.json`; favicons follow the browser's color
scheme independently of the page. The marketing-kit test checks HTTP hashes,
theme links and the header wordmark. See the [interface screenshots](design/screenshots/interface-refresh/README.md).
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

On `/examples`, the public library opens on the app's real graph canvas, node/edge components and
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
Phone library panels use compact 16px insets and 20px note padding. The complete
largest sample still determines the shared height; no note or graph detail is clipped.

## Setup and public documentation

`/docs/notebook` publishes the maintained [workspace guide](workspace.md) through
the existing allowlist. It takes a browser user from account creation to a saved
note and checked citation, followed by writing, sharing and recovery reference.
`/install` remains the separate guided connection path. It distinguishes browser
approval, client-specific activation and a fresh-session save/recall check; API
access alone is not host verification. The [client guide](client.md) owns exact
commands, grants, revocation and diagnosis, rather than copying the reference
into the marketing page.

Public guides keep a persistent desktop sidebar and use a native “Guides and
reference” disclosure on phones, leaving the article close to its heading without
requiring JavaScript. Mobile pricing aligns both plans with the page frame instead
of adding another inset. Failed native sharing/clipboard access opens a focused
native dialog with a selected link, Done/Escape dismissal and focus return; neither
copy feedback nor recovery resizes the footer. These are public-site behaviors,
not changes to notebook sharing or billing configuration.

See [reviewed desktop/phone home and pricing screenshots](design/screenshots/product-redesign/README.md).
Build and browser checks use local source/fixtures, not payment/provider or
production acceptance. Publication still follows protected release promotion.

## Public discovery

Public routes use initial-HTML metadata, route-specific canonical/sharing URLs
and approved 1200 × 630 social PNGs. `/llms.txt` exposes only public product facts
and documentation links and is advertised in the document head. It is an emerging
supplement, not an AI-ingestion or citation guarantee. Preview/development and
`SITE_NOINDEX=true` serve noindex, disallow-all robots rules and an empty sitemap.
Private app, account and shared-note URLs remain excluded; robots is not access
control. Public styling stays scoped away from the authenticated workspace.

## Historical Collection 05 material

The Collection 05 website led with a private notebook that made saved notes easy
to find. Its main action was notebook signup. The developer section explained
saved context across coding sessions and linked to agent setup. The current
AI-notebook positioning and scoped typography are described above.

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
- The approved Sprout mark remains. The media kit ships brand fonts. Collection 05
  used system fonts for website interface text; current public/account-entry text
  uses scoped Space Grotesk, while code can use JetBrains Mono.
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

## Browser extension and revision comparisons (7 November 2026)

The home feature index now includes the shipped browser extension: locally
installable unsigned packages for Chrome, Firefox and Edge, on-device spelling
and grammar checks, optional sentence-level AI rewrites behind explicit consent
plus a separate connection permission and provider configuration, and panel
capture/search/sharing. At the time, setup required a local package; see the
[extension guide](browser-extension.md) for current installation options. The
History row mentions grouped before/after revision comparisons from the shipped
structured-notes work. An extension FAQ entry and an `/install` extension
section link the repository's `browser-extension.md` setup guide; no new public
route, navigation entry or sitemap change was added. Notebook assistance
(summaries, suggested filing, action lists, visit digests, review) remains
unmarketed workspace behavior documented in `notebook-assistance.md`.
