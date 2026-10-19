import { z } from "zod";

const origin = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Use an HTTPS origin (HTTP is allowed on loopback)",
    });
    return z.NEVER;
  }
  return url.origin;
});
export const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(26080),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(["require", "disable"]).default("disable"),
  API_ORIGIN: origin,
  SITE_URL: origin,
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_ISSUER: origin,
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().min(1),
  EMBEDDING_MODE: z.enum(["local", "disabled"]).default("local"),
  EMBEDDING_CACHE: z.string().default("./data/models"),
  CURSOR_SECRET: z.string().min(32),
});
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
export function readServerEnvironment(env = process.env): ServerEnvironment {
  return serverEnvironmentSchema.parse(env);
}
