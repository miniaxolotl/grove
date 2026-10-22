# Minimal website refresh

Captured on 22 October 2026 from the local production build of
`feature/website-minimal-refresh`, in Chromium at 1440px and 390px. Reduced motion
is enabled for stable full-page images; the marketing palette remains light in
either system theme.

- [Desktop](desktop.png)
- [Mobile](mobile.png)
- [Notebook graph selected by keyboard](notebook-graph.png)
- [Cookie Settings hover](consent-hover.png)

The public site uses shorter notebook-led copy, open feature rows and a wide
interactive notebook. Notes, By date and Graph remain keyboard-operable. Query,
answer and connection entrances respond to selection and respect reduced motion.
Compact controls use Grove's accent with visible hover, pressed and focus states.
Consent has explicit primary, secondary and Settings treatments.

Presentation rules are scoped to public marketing. The authenticated workspace
keeps its own components and styles. Notes, queries, connections and terminal
snippets remain labelled examples with no account mutations.

Verification includes 160 browser cases, root/website lint, types and builds,
and five shipped-artifact checks. Responsive review covers WCAG A/AA axe,
overflow and console errors at 320/390/768/1440px. The Settings regression test
first reproduced 1:1 hover contrast on the previous build. Existing illustrations
and fonts retain their approved provenance; no new photo fixtures are added.
