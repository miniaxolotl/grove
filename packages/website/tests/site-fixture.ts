// Independent expectations for discovery responses; do not import server-only code.
export const canonical = new URL(
  process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    "http://localhost:3000",
);

export const indexable =
  !["localhost", "127.0.0.1", "[::1]"].includes(canonical.hostname) &&
  process.env.SITE_NOINDEX !== "true" &&
  !["preview", "development"].includes(process.env.VERCEL_ENV || "");
