import { site } from "@/lib/site";

export const dynamic = "force-static";

export function GET() {
  return new Response(
    `# Grove

> A private notebook for notes, plans and journal entries, by Bramble Labs Inc.

Grove offers notebooks, keyword and semantic search, and Ask answers with links back to source notes. Optional AI connections have scoped permissions. Website examples are sample content, not customer notes.

## Public references
- [Grove](${site.url}/): notebook features and account creation.
- [Pricing](${site.url}/pricing): current standard allowances, monthly pricing and upgrade availability. Billing may be unavailable; do not infer purchasability from a displayed price.
- [Connect AI tools](${site.url}/install): cloud connections and setup.
- [Documentation](${site.url}/docs): public reference hub.
- [Client](${site.url}/docs/client): CLI and integration reference.
- [Server](${site.url}/docs/server): service reference.
- [Models](${site.url}/docs/models): model configuration and availability.
- [Ask tools](${site.url}/docs/ask-tools): tool behavior and limits.
- [Hosted chat](${site.url}/docs/hosted-chat): supported hosted-client setup.
- [Self-host](${site.url}/self-host): independent deployment information.
- [Support](${site.url}/support): product help.
- [Contact](${site.url}/contact): public contact details.
- [Privacy](${site.url}/privacy): privacy practices.
- [Terms](${site.url}/terms): terms of use.

## Privacy boundary
Private notes are not public documentation. Account, workspace, API and shared-reader routes are not part of this guide or the public sitemap. A shared-reader URL is a capability, not a public discovery source. This guide grants no access to notes or accounts. Linked public pages own current features, limits and terms.
`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
