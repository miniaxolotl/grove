# @script/setup

Applies forward-only PostgreSQL migrations using `MIGRATION_DATABASE_URL`.

## Usage

```bash
pnpm run dev:setup
```

Or from monorepo root:

```bash
pnpm --filter @script/setup run setup
```

## What it does

- Applies missing schema migrations; repeat runs preserve existing data.
- Requires migration-owner credentials. API/worker use separate non-owner roles.
- See `documentation/deploy.md` for role bootstrap and PostgreSQL Compose setup.
