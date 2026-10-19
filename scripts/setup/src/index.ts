// Explicit migrations only. Re-running setup never deletes stored data.
await import("../../../packages/api/src/migrate.ts");
export {};
