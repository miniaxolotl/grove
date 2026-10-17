# Grove website

The Grove marketing website, published as the private pnpm workspace package `website`.

Primary URL: <https://grove-six-rosy.vercel.app>. A developer tool by Bramble Labs Inc.
Grove and Burrow share neutral surfaces, sans-serif headings, terminal previews,
and direct installation paths; Grove uses green product accents.

## Develop

From the monorepo root:

```bash
pnpm install
pnpm dev:website
```

Open <http://localhost:3000>. The website runs independently of Grove and Qdrant; the memory demo is an illustrative, local interaction.

## Production

Copy `packages/website/.env.example` to `packages/website/.env.local` and set `SITE_URL=https://grove-six-rosy.vercel.app` for production. This origin is used for canonical URLs, social sharing, Open Graph metadata, structured data, robots, and the sitemap. Vercel’s project production URL is used when `SITE_URL` is absent; the local development fallback is `http://localhost:3000`.

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

| Location                   | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `src/app/page.tsx`         | Marketing homepage                          |
| `src/app/install/page.tsx` | Dedicated installation guide                |
| `src/app/globals.css`      | Tailwind theme and visual styles            |
| `src/components/`          | Feature sections and interactive components |
| `src/content/`             | Navigation, FAQs, and installation commands |
| `src/lib/site.ts`          | Public origin and official project links    |
| `tests/website.spec.ts`    | Production-browser integration checks       |

Installation examples follow the repository's actual Docker, npm, and MCP setup. Keep them in sync when server or plugin behavior changes. The site describes tool-based memory retrieval and the current plugin hooks, without claiming automatic conversation capture or automatic context injection.

## Checks

```bash
pnpm lint:website
pnpm check-types:website
pnpm build:website
pnpm --filter website exec playwright install chromium
pnpm test:website
```

Browser tests use the production build on port 3100 (override with `WEBSITE_TEST_PORT`). Build and run tests with the same `SITE_URL`; when using a custom `.env.local`, also export that value for the test runner. Tests cover no-JavaScript content, keyboard navigation, installation and clipboard flows, share fallbacks, SEO/image routes, responsive layouts, and WCAG accessibility checks.
