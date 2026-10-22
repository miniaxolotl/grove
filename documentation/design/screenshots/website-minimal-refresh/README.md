# Minimal website refresh

Captured on 22 October 2026 from the local production build of
`feature/website-minimal-refresh`, in Chromium at 1440px and 390px. Reduced motion
is enabled for stable full-page images; the marketing palette remains light in
either system theme.

- [Desktop](desktop.png)
- [Mobile](mobile.png)
- [Notebook graph selected by keyboard](notebook-graph.png)
- [Cookie Settings hover](consent-hover.png)
- [Shared header](header.png), [footer](footer.png) and [mobile menu](menu-mobile.png)

The public site uses shorter notebook-led copy, open feature rows and a wide
interactive notebook. Notes, By date and Graph remain keyboard-operable. Query,
answer and connection entrances respond to selection and respect reduced motion.
Compact controls use Grove's accent with visible hover, pressed and focus states.
Consent has explicit primary, secondary and Settings treatments.

Screenshot follow-up: primary actions are 34px high on desktop; header, tabs and
consent controls are 32px. Cookie settings actions have no underline in any state.

Family navigation follow-up: 72px desktop / 64px mobile header rows, a 1024px
navigation breakpoint and outlined 32px actions match the other three websites.
Below 360px the primary destination lives in the menu. Footers share three desktop
columns, two mobile link columns and an ordered legal/preferences row. Menu controls
use 36px coarse-pointer targets. Dismissal, resize and legal-page navigation are
also reviewed at 1023/1024px.

Marketing header/footer wordmarks opt into compact SVGs derived from the approved
brand-kit horizontal logos. Only their outer canvas/viewBox (`188 86 1224 228`)
is trimmed; paths/colors are retained. Other Brand instances keep their existing
asset and sizing.

Presentation rules are scoped to public marketing. The authenticated workspace
keeps its own components and styles. Notes, queries, connections and terminal
snippets remain labelled examples with no account mutations.

Verification after integrating the timed-sharing/auth-isolation baseline includes
163 browser cases, root/website lint, types and builds,
and five shipped-artifact checks. Responsive review covers WCAG A/AA axe,
overflow and console errors at 320/390/768/1440px. The Settings regression test
first reproduced 1:1 hover contrast on the previous build. Existing illustrations
and fonts retain their approved provenance; no new photo fixtures are added.
