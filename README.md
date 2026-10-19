# Grove

Private memory across your AI agents, by **Bramble Labs Inc.**

Keep useful preferences, confirmed decisions, facts, verified solutions, and bounded
task handoffs. Browse, correct, archive, export, or delete them in your memory library.

**Four tools:** `remember`, `recall`, `memories`, `forget`.
**One boundary:** every website and agent request goes through the authenticated API.
**One database:** PostgreSQL, full-text search, and pgvector, with account-owned rows
and non-owner runtime roles enforcing row-level security.

[Website](https://usegrove.cloud) · [Tools/API](documentation/server.md) ·
[Agent installation](documentation/client.md) · [Hosting](documentation/deploy.md) ·
[Delivery evidence](documentation/delivery.md)

## Connect an agent

Connect to **Grove Cloud**, from your project directory (Node 22+ and your agent installed):

```sh
npx @miniaxolotl/grove connect opencode
```

Replace `opencode` with `claude` or `codex` for those clients. Sign in and approve
access in the browser. Grove links your current project, verifies access and installs
the integration. Keep the terminal open, then restart your agent when prompted.
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
- Handoffs leave active recall after 30 days and are purged after 90 days.
- Archive is reversible and excluded from recall. Permanent deletion removes live
  content, revisions, embeddings, and pending content jobs transactionally.
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
source-read-only. Canonical execution plans are in the main checkout's `plans/`;
this supersedes the earlier Fern planning location.

## License

[MIT](LICENSE)
