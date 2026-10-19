# Legacy data import

The normal runtime, setup, Compose and CI use PostgreSQL only. Qdrant exists solely
as an optional **read-only source** for this explicit importer.

1. Keep the source stopped for writes and take an operator backup.
2. Create destination Grove accounts/projects. Issue a scoped import key per owner.
3. Create an ownership file. Every legacy project (including missing/null project)
   must map explicitly; the importer never infers ownership from a session or tag.

```json
{
  "sourceId": "my-old-grove",
  "collectionPrefix": "memory",
  "apiOrigin": "https://YOUR-GROVE-API",
  "owners": [
    {
      "legacyProject": "my-app",
      "accountId": "ACCOUNT-UUID",
      "projectId": "PROJECT-UUID",
      "keyEnv": "OWNER_IMPORT_KEY"
    }
  ]
}
```

```sh
# Set LEGACY_QDRANT_URL, optionally LEGACY_QDRANT_API_KEY, and OWNER_IMPORT_KEY.
pnpm --filter @script/migrate-legacy import --mapping ownership.json --snapshot old-grove-dry-run.ndjson
# Review counts, mapping and private snapshot before applying:
pnpm --filter @script/migrate-legacy import --mapping ownership.json --snapshot old-grove-import.ndjson --apply
```

Each new 0600 snapshot preserves all original payloads and vectors, including
entities/relations retired from the active product. Source calls use only the
read-only scroll endpoint. Target credentials are checked against the declared
account before any writes. No token goes in the mapping file or command line.

Valid memories are imported as facts into the **archive for review**. Stable source
operation IDs prevent duplicate import and resurrecting a later-deleted save.
Conflicting changed source payloads require explicit review/correction. Unmapped,
invalid/oversize and conflicting records are counted (exit 2), never truncated or
silently assigned. Snapshots retain them for review. Network failure stops the run
(exit 1); repeat with the same mapping/source ID and a new snapshot path.

Review the archive, promote useful memories to the appropriate kind, then restore
them. Keep the old store and private snapshots until ownership/count verification
and backups are complete. The importer never deletes its source.
