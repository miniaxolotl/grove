import type { CaptureResult } from "posthog-js";

export const analyticsEvents = [
  "cta_clicked",
  "product_link_clicked",
  "install_command_copied",
  "docs_link_clicked",
  "operation_completed",
] as const;
export type AnalyticsEvent = (typeof analyticsEvents)[number];
export type Placement = "hero" | "install" | "footer" | "preview";
export const operations = [
  "copy_install_command",
  "copy_example_command",
  "memory_write",
  "memory_recall",
  "chat",
  "connection",
  "settings",
  "workspace_read",
] as const;
export type Operation = (typeof operations)[number];
export type Outcome = "success" | "unavailable" | "error";
export const origin = "https://usegrove.cloud";
const publicRoutes = new Set([
  "/",
  "/install",
  "/self-host",
  "/privacy",
  "/terms",
]);
const workspaceRoutes = new Set([
  "/app",
  "/app/journal",
  "/app/ask",
  "/app/projects",
  "/app/profile",
  "/app/connections",
  "/app/settings",
  "/app/archive",
  "/app/graph",
]);
export function pagePath(value: string): string {
  try {
    const path = new URL(value, origin).pathname.replace(/\/$/, "") || "/";
    if (publicRoutes.has(path) || workspaceRoutes.has(path)) return path;
    if (path.startsWith("/s/")) return "/s/:token";
    const dynamic = path.match(
      /^\/(app\/(notes|memories|projects|connect)|sign-in|sign-up)(?:\/|$)/,
    );
    return dynamic
      ? `/${dynamic[1]}${dynamic[1].startsWith("app/") ? "/:id" : ""}`
      : "/other";
  } catch {
    return "/other";
  }
}
export function safePageUrl(value: string): string {
  return `${origin}${pagePath(value)}`;
}
export function replayAllowed(value: string): boolean {
  return publicRoutes.has(pagePath(value));
}
export function surface(value: string): "website" | "workspace" {
  return pagePath(value).startsWith("/app") ? "workspace" : "website";
}
export function operationForRequest(path: string, method: string): Operation {
  const route = path.split("?")[0];
  if (route === "/memories/search") return "memory_recall";
  if (/^\/(recall|search|context)(\/|$)/.test(route)) return "memory_recall";
  if (/^\/(chat|conversations)(\/|$)/.test(route)) return "chat";
  if (/^\/(connections|connect|keys|grants)(\/|$)/.test(route))
    return "connection";
  if (/^\/(settings|profile)(\/|$)/.test(route)) return "settings";
  if (
    method !== "GET" &&
    /^\/(memories|notes|projects|notebooks)(\/|$)/.test(route)
  )
    return "memory_write";
  return "workspace_read";
}
export function maskReplayAttribute(name: string, value: string): string {
  name = name.toLowerCase();
  if (["href", "src", "action", "formaction", "xlink:href"].includes(name))
    return safePageUrl(value);
  if (
    [
      "value",
      "title",
      "alt",
      "placeholder",
      "aria-label",
      "aria-description",
      "srcset",
    ].includes(name) ||
    name.startsWith("data-")
  )
    return "[masked]";
  return name === "style" ? value.replace(/url\([^)]*\)/gi, "none") : value;
}
const sdkEvents = new Set([
  "$pageview",
  "$pageleave",
  "$web_vitals",
  "$feature_flag_called",
  "survey shown",
  "survey sent",
  "survey dismissed",
]);
const sdkProperties = new Set([
  "token",
  "distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
  "$os",
  "$os_version",
  "$browser",
  "$browser_version",
  "$device_type",
  "$screen_width",
  "$screen_height",
  "$viewport_width",
  "$viewport_height",
  "$is_identified",
  "$time",
  "$pageview_id",
  "$prev_pageview_id",
  "$prev_pageview_duration",
  "$prev_pageview_max_scroll_percentage",
  "$prev_pageview_max_content_percentage",
  "$feature_flag",
  "$feature_flag_response",
  "$feature_flag_reason",
  "$feature_flag_request_id",
  "$survey_id",
  "$survey_name",
  "$survey_iteration",
  "$survey_iteration_start_date",
]);
function referringDomain(value: string): string {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      url.hostname.includes(".") &&
      !/^[\d.:[\]]+$/.test(url.hostname)
      ? url.hostname
      : "$direct";
  } catch {
    return "$direct";
  }
}
export function sanitizeEvent(
  event: CaptureResult,
  currentUrl: string,
  referrer: string,
): CaptureResult | null {
  if (event.event === "$snapshot") {
    if (!replayAllowed(currentUrl)) return null;
    const keys = new Set([
      "token",
      "distinct_id",
      "$session_id",
      "$window_id",
      "$lib",
      "$lib_version",
      "$snapshot_data",
      "$snapshot_bytes",
      "$snapshot_host",
    ]);
    return {
      uuid: event.uuid,
      event: event.event,
      timestamp: event.timestamp,
      properties: Object.fromEntries(
        Object.entries(event.properties).filter(([key]) => keys.has(key)),
      ),
    };
  }
  if (
    !sdkEvents.has(event.event) &&
    !(analyticsEvents as readonly string[]).includes(event.event)
  )
    return null;
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.properties)) {
    if (
      sdkProperties.has(key) &&
      ["string", "number", "boolean"].includes(typeof value)
    )
      properties[key] = value;
    if (
      /^\$web_vitals_(LCP|INP|CLS|FCP|TTFB)_value$/.test(key) &&
      typeof value === "number" &&
      Number.isFinite(value)
    )
      properties[key] = value;
    if (
      /^\$survey_response(?:_[a-z0-9-]+)?$/.test(key) &&
      /^[1-5]$/.test(String(value))
    )
      properties[key] = Number(value);
    if (
      /^\$feature\/(session-replay|product-feedback|website-cta-copy)$/.test(
        key,
      ) &&
      (typeof value === "boolean" || value === "control" || value === "benefit")
    )
      properties[key] = value;
  }
  const input = event.properties;
  if (["fern", "grove", "burrow"].includes(input.target_product))
    properties.target_product = input.target_product;
  if (["hero", "install", "footer", "preview"].includes(input.placement))
    properties.placement = input.placement;
  if ((operations as readonly string[]).includes(input.operation))
    properties.operation = input.operation;
  if (["success", "unavailable", "error"].includes(input.outcome))
    properties.outcome = input.outcome;
  if (
    typeof input.duration_ms === "number" &&
    Number.isFinite(input.duration_ms)
  )
    properties.duration_ms = Math.max(0, Math.min(input.duration_ms, 300_000));
  if (
    typeof input.release === "string" &&
    /^[a-z0-9@._-]{1,100}$/i.test(input.release)
  )
    properties.release = input.release;
  if (
    typeof input.version === "string" &&
    /^\d+\.\d+\.\d+$/.test(input.version)
  )
    properties.version = input.version;
  // Campaign dimensions are public, low-cardinality labels, never redirect/identity tokens.
  for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
    if (
      typeof input[key] === "string" &&
      /^[a-z][a-z0-9_-]{0,63}$/i.test(input[key])
    )
      properties[key] = input[key];
  }
  return {
    uuid: event.uuid,
    event: event.event,
    timestamp: event.timestamp,
    properties: {
      ...properties,
      product: "grove",
      surface: surface(currentUrl),
      environment: "production",
      $current_url: safePageUrl(currentUrl),
      $pathname: pagePath(currentUrl),
      $host: "usegrove.cloud",
      $referring_domain: referringDomain(referrer),
      $referrer: referringDomain(referrer),
      $process_person_profile: false,
      $geoip_disable: true,
    },
  };
}
