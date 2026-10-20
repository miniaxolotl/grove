# Grove website design kit

Collection 04, 20 October 2026. Canonical home: https://usegrove.cloud.

## Files

- `/brand-kit/index.html`: visual specimen and individual downloads.
- `tokens.css`: runtime semantic colours. `tokens.json`: shared layout and motion.
- `asset-manifest.json`: marketing-library provenance and SHA-256 of imported assets.
- `../public/brand-kit/`: outlined primary/inverse signatures, wordmarks, symbols,
  native-size icons, WOFF2 fonts and licences, social artwork and campaign banner.
- The accompanying PDF is the printable brand guide.

## Identity and type

Preserve the approved **19 / Sprout** and outlined wordmark, including padding.
Use **Space Grotesk** at 600 for headlines, 500 for section titles and navigation,
400 for body copy. Reserve **JetBrains Mono** at 400/500 for code and structured
metadata. Keep headlines upright. Fonts are self-hosted and their licences travel
with them. Authentic product captures retain their original UI and provenance.

Paper `#faf9f3`, forest/ink `#284c38`, support `#c7df9e`. Use calm notebook pages,
journal fragments and visibly related notes. Label illustrated workflows.

## Composition

Use the family 1280px frame, 20/32/48px gutters and 8px spacing rhythm. Controls
are at least 44px, primary actions 48px. Use 12px buttons and 16 to 24px surfaces.
`src/app/brand-family.css` is the collection layer after the structural CSS.

Lead with the private notebook. Show writing, nested notebooks, journaling, semantic
search and connections. The dedicated developer section explains scoped agent
memory without making it a prerequisite for taking notes.

Notebook signup: **/sign-up**. Connected-agent setup: **/install**. Self-hosting:
**/self-host**. Keep these paths distinct. The connection command is
`npx @miniaxolotl/grove connect`. Supported tools include OpenCode, Claude Code and
Codex. Current storage is PostgreSQL/pgvector; model choices vary by deployment.

## Voice, motion and quality

Thoughtful, human and concrete. Start with the idea worth keeping. Use technical
language in the developer sequence, short sentences and ordinary punctuation.
Avoid claims that Grove automatically remembers everything or reads every note.

Entrances take 700 to 900ms, one-time section reveals 600ms, interactions 200ms.
Reduced motion is static and content stays readable without JavaScript. Preserve
keyboard navigation, focus, authentic product behaviour and tenant boundaries.

Run repository lint, types, build, artifact checks and the website regression
suite. Review notebook and agent destinations, auth setup, legal pages, narrow
layouts, contrast, reduced motion, icons and sharing. Record browser captures in
documentation/design/screenshots with viewport and fixture provenance.
