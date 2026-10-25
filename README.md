# Grove

Private memory across your AI agents, by **Bramble Labs Inc.**

Keep useful preferences, confirmed decisions, facts, verified solutions, and bounded
task handoffs. Browse, correct, archive, export, or delete them in your memory library.

**Memory and notebook tools:** recall, search, exact reads, partial edits, history,
filing, archive/restore and deletion. [Tool reference](documentation/server.md#memory-and-notebook-tools).
**One boundary:** every website and agent request goes through the authenticated API.
**One database:** PostgreSQL, full-text search, and pgvector, with account-owned rows
and non-owner runtime roles enforcing row-level security.

[Website](https://usegrove.cloud) · [Tools/API](documentation/server.md) ·
[Agent installation](documentation/client.md) · [Hosting](documentation/deploy.md) ·
[Delivery evidence](documentation/delivery.md)

The website's `/docs` reference hub builds directly from selected committed docs.
See [public reference maintenance](documentation/website-discovery.md) for the
allowlist, link handling and privacy boundaries. Source delivery does not imply
that the new routes are already deployed.

Configurable [embedding, decision and generation providers](documentation/models.md)
add semantic search, generated titles/tags, related memories, and source-linked
personal profiles, project briefs and task handoffs. Cloud uses full 4,096-dimensional
Qwen embeddings and Clef decisions on DeepInfra, with MiniMax M3.1 Flash generation.

## Connect a web chat

Use the remote MCP endpoint `https://api.usegrove.cloud/mcp` in **ChatGPT** or
**Claude web**, sign in with OAuth, then approve the matching client in Grove
Connections. No terminal or API key is needed. This is a custom-connection beta,
not a public-directory listing; host/account policies apply. See the
[setup steps, permissions and verification limits](documentation/hosted-chat.md).

## Connect a coding agent

Connect to **Grove Cloud**, from your project directory (Node 22+ and your agent installed):

```sh
npx @miniaxolotl/grove connect
```

Grove detects your installed agent or lets you choose. You can also specify
`connect opencode`, `connect claude` or `connect codex`. Create an account or sign in
in the browser, then approve access. Grove links your current project, verifies
access and configures the integration. Keep the terminal open and follow its
agent-specific activation step.
Run the same command to resume interrupted setup.
Named, revocable API keys also support headless clients. Credentials stay in your
user configuration; plugins and hooks use the same connection. Ordinary agent
credentials cannot manage your account or issue other credentials.

**Grove Open Source** runs on your infrastructure. Add `--url https://YOUR-GROVE-API`
to connect to your own deployment. See the [rollout requirements](documentation/cloud-onboarding.md#rollout)
for the release introducing `connect`; earlier CLI releases use `grove init`.

## Host Grove

Requires Node 24/pnpm 10.33 for development, or Docker Compose for the service.
Configure a **dedicated Grove Clerk application** and website, then:

```sh
cp .env.example .env
# Set Clerk keys, webhook secret, and generated database/cursor passwords.
docker compose up -d --build
curl --fail http://localhost:26080/health/ready
```

Compose runs private pgvector PostgreSQL, forward-only migrations, a non-owner API,
and a separate job worker. The database has no published port. Local embeddings
initialize before readiness. See [deployment](documentation/deploy.md) for the
website, TLS, OAuth resource settings, backups, and Neon/DigitalOcean configuration.

## Memory policy

- Durable saves remain until explicitly changed or deleted.
- Handoffs leave active recall after 30 days by default, with a 60-day restore window.
- Archive is reversible and excluded from recall. Deletion removes access and
  derived work; authored notes and history remain retained behind soft-delete
  policies, without an automatic physical-purge deadline. See
  [retained deletion](documentation/jobs.md#retained-deletion).
- Saves report indexing separately; lexical retrieval remains available while
  embeddings are pending. The embedding model never silently changes.
- Automatic recall is bounded; hooks never upload raw transcripts or tool logs.
- Server-side search is **not end-to-end encryption**. Recalled text has also been
  delivered to your agent, whose retention policies are separate.

## Development

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check-types
pnpm lint
pnpm dev:website
```

[Verification commands](documentation/development/testing.md) cover actual
PostgreSQL/RLS, authenticated HTTP/MCP, packed stdio clients, and browser checks.
[Legacy import](documentation/migration.md) is explicit, ownership-mapped, and
source-read-only. Local execution plans are in
`~/Development/bramble-labs/plans/grove/` (`plan.md`, `notes.md`, `status.md`);
recovered `sources/` are historical snapshots. The tracked
[images, recordings and speech review](documentation/development/media-plan.md)
records proposed scope and acceptance gates, not shipped functionality.
Current implementation contracts are documented under [media](documentation/media.md),
[recordings](documentation/recordings.md) and opt-in [speech](documentation/speech.md);
production activation follows the release and explicit migration procedure.

## Releases

Release Please manages one coordinated product version across the server, CLI
and three integrations. A released tag is deliberately frozen and promoted from
`development` through a protected PR to `production`. Only production publishes
packages, images and the website. See the [release runbook](documentation/deploy.md#releases).

## License

[MIT](LICENSE)
