# Grove — selected Sprout identity

The selected identity is **19 / Sprout** from botanical round 04: a single
two-leaf silhouette and the uppercase, outlined Space Grotesk wordmark.

- Primary green: `#284c38`; ivory: `#faf9f3`.
- Website lockups: `packages/website/public/brand/grove-logo*.svg`.
- Symbol geometry: `packages/website/src/lib/brand-mark.ts`.
- The header, footer, signed-in workspace, hero illustrations, favicon,
  Apple icon, Clerk logo, and Open Graph image use the selected artwork.
- The font license accompanies the outlined SVGs in `public/brand/`.

The web lockups retain the approved paths and proportions with their outer
canvas trimmed for inline placement. The full-size logo masters and earlier
studies are retained in the separate marketing library.

## Review — October 19, 2026

The rollout includes the previously deployed Speed Insights commit `0654b61`.
Local visual review covers 320, 390, and 1440px layouts, the isolated dashboard,
the Open Graph image, and the Apple icon. All logo images load, with no document
overflow or browser exceptions. The dashboard fixture serves the real SVGs
and adapts Next Image to its isolated browser environment.

ESLint, type generation/type checking, and the production build pass. All
19 existing Playwright tests pass, including dashboard mutations and recovery.

Screenshots: [`screenshots/grove-sprout/`](screenshots/grove-sprout/).
