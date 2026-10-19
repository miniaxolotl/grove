# Grove website

Grove marketing and the Clerk-authenticated memory library, in private workspace package `website`.

Primary URL: <https://usegrove.cloud>. A developer tool by Bramble Labs Inc.
Grove and Burrow share warm ivory surfaces, DM Sans with Instrument Serif accents,
terminal previews, and direct installation paths; Grove uses green product accents.
Their product-family footer links to Bramble Labs, Fern, Burrow, and Grove.
Vercel Web Analytics is included only in the public marketing layout.
Website privacy information is linked at https://bramblelabs.co/privacy.

## Develop

From the monorepo root:

```bash
pnpm install
pnpm dev:website
```

Open <http://localhost:3000>. Public marketing and its illustrative demo work independently.
The private `/app` library needs Grove Clerk keys and `GROVE_API_URL`; every data
operation forwards the signed-in user's token to the authenticated API, uncached.
Set the variables in `.env.example` in an ignored `.env.local` file. Without them,
private routes show a setup state and no memory data.

## Production

Set `SITE_URL=https://usegrove.cloud`, `GROVE_API_URL=https://api.usegrove.cloud`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in Vercel's production
environment. Production builds follow the `production` branch; previews use
separate environment settings. Redeploy after changing public Clerk keys.
`SITE_URL` supplies canonical URLs, social metadata, robots and the sitemap.
Vercel's project production URL is the fallback; local development uses
`http://localhost:3000`. See the [hosting runbook](../../documentation/deploy.md).

```bash
pnpm build:website
pnpm start:website
```

Deploy from the repository root using `pnpm install --frozen-lockfile`, `pnpm build:website`, and `pnpm start:website`. Set `SITE_URL` during both build and runtime. Next.js respects the host's `PORT` environment variable. Requires Node.js 22+ and pnpm 10.33.0.

## Stack and structure

- Next.js App Router with request-time SSR (`connection()`) for `/` and `/install`.
- React Server Components for the page content, with small client components for tabs, copying, navigation, and sharing.
- Tailwind CSS v4. Shared TypeScript and ESLint workspace configurations, extended for Next.js.
- Locally bundled DM Sans and Instrument Serif fonts; no external font requests.
- Generated 1200×630 Open Graph image, X/Twitter cards, favicon, Apple icon, canonical URLs, sitemap, robots, and JSON-LD.
- Native Web Share with clipboard/manual-copy fallbacks, plus X, LinkedIn, and Bluesky sharing links.

| Location                               | Purpose                                       |
| -------------------------------------- | --------------------------------------------- |
| `src/app/(marketing)/page.tsx`         | Marketing homepage                            |
| `src/app/(marketing)/install/page.tsx` | Dedicated installation guide                  |
| `src/app/(auth)/`                      | Clerk signup and signin                       |
| `src/app/app/`                         | Private memory library and account management |
| `src/app/api/grove/`                   | Authenticated, uncached API proxy             |
| `src/app/globals.css`                  | Tailwind theme and visual styles              |
| `src/components/`                      | Feature sections and interactive components   |
| `src/content/`                         | Navigation, FAQs, and installation commands   |
| `src/lib/site.ts`                      | Public origin and official project links      |
| `tests/website.spec.ts`                | Production-browser integration checks         |

Installation examples follow the repository's Docker, npm, and MCP setup. Keep them in sync when server or plugin behavior changes. Hooks provide bounded optional context; memory skills curate concise saves. Raw conversations and tool logs are never automatically uploaded.

## Checks

```bash
pnpm lint:website
pnpm check-types:website
pnpm build:website
pnpm --filter website exec playwright install chromium
pnpm test:website
```

Browser tests use the production build on port 3100 (override with `WEBSITE_TEST_PORT`). Build and run tests with the same `SITE_URL`; when using a custom `.env.local`, also export that value for the test runner. Tests cover no-JavaScript content, keyboard navigation, installation and clipboard flows, share fallbacks, SEO/image routes, responsive layouts, and WCAG accessibility checks.
