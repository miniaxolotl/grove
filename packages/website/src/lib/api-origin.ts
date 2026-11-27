/** Server-only configuration input, shared by signed-in and anonymous proxies. */
export function apiOrigin(value: string | undefined) {
  const origin = new URL(value ?? "");
  if (
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid API configuration");
  return origin;
}
