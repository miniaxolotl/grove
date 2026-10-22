import { test as base, expect } from "@playwright/test";
import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";

export type CapturedEvent = {
  event: string;
  properties: Record<string, unknown>;
};
export type SentryItem = { type: string; body: Record<string, unknown> };
function decodeReplay(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("\u001f\u008b"))
    return decodeReplay(
      JSON.parse(gunzipSync(Buffer.from(value, "latin1")).toString()),
    );
  if (Array.isArray(value)) return value.map(decodeReplay);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, decodeReplay(child)]),
    );
  return value;
}
export const test = base.extend<{
  telemetry: {
    events: CapturedEvent[];
    requests: string[];
    sentry: SentryItem[];
  };
  telemetrySettings: { replay: boolean; variant: false | "benefit" };
}>({
  telemetrySettings: [{ replay: false, variant: false }, { option: true }],
  telemetry: [
    async ({ context, telemetrySettings }, use, testInfo) => {
      // Returning analytics consent; first-visit choices are covered by tag-manager.spec.ts.
      await context.addCookies(
        ["127.0.0.1", "localhost"].map((domain) => ({
          name: "cc_cookie",
          domain,
          path: "/",
          value: encodeURIComponent(
            JSON.stringify({
              categories: ["necessary", "analytics"],
              revision: 1,
              consentId: "7cb1f2a0-1b21-43b3-9d36-6bbf71224239",
              services: {},
              consentTimestamp: new Date().toISOString(),
              lastConsentTimestamp: new Date().toISOString(),
              expirationTime: Date.now() + 86400000,
            }),
          ),
        })),
      );
      const events: CapturedEvent[] = [],
        sentry: SentryItem[] = [],
        requests: string[] = [];
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        Object.defineProperty(navigator, "userAgentData", {
          get: () => undefined,
        });
        Math.random = () => 0.01;
      });
      await context.route(/^https:\/\/[^/]*sentry\.io\//, async (route) => {
        requests.push(route.request().url());
        const raw = route.request().postDataBuffer();
        if (raw) {
          const text =
            raw[0] === 0x1f && raw[1] === 0x8b
              ? gunzipSync(raw).toString()
              : raw.toString();
          const lines = text.trim().split("\n");
          for (let i = 1; i < lines.length; i += 2)
            sentry.push({
              type: JSON.parse(lines[i]).type,
              body: JSON.parse(lines[i + 1]),
            });
        }
        await route.fulfill({
          status: 200,
          headers: { "access-control-allow-origin": "*" },
          contentType: "application/json",
          body: "{}",
        });
      });
      await context.route(/^https:\/\/[^/]*posthog\.com\//, async (route) => {
        const request = route.request();
        requests.push(request.url());
        const url = new URL(request.url());
        const config = {
          analytics: { endpoint: "/i/v0/e/" },
          sessionRecording: telemetrySettings.replay
            ? {
                endpoint: "/s/",
                recorderVersion: "v2",
                scriptConfig: { script: "posthog-recorder" },
                sampleRate: "1",
                recordCanvas: false,
                consoleLogRecordingEnabled: false,
                masking: {
                  maskAllInputs: true,
                  maskTextSelector: "*",
                  blockSelector:
                    "img, video, canvas, iframe, [data-private], .ph-no-capture, .grove-app, .connect-shell, .auth-page, .cl-rootBox, .cl-portal",
                },
              }
            : false,
          autocapture_opt_out: true,
          capturePerformance: false,
          supportedCompression: ["gzip-js"],
          surveys: false,
        };
        if (url.pathname.endsWith("/config.js")) {
          const token = url.pathname.split("/")[2];
          await route.fulfill({
            contentType: "application/javascript",
            body: `window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {}; window._POSTHOG_REMOTE_CONFIG[${JSON.stringify(token)}] = ${JSON.stringify({ config, siteApps: [] })};`,
          });
          return;
        }
        if (url.pathname.endsWith(".js")) {
          const name = url.pathname.split("/").at(-1)!;
          if (
            ![
              "web-vitals-with-attribution.js",
              "surveys.js",
              "posthog-recorder.js",
            ].includes(name)
          )
            throw new Error(`Unexpected SDK extension: ${name}`);
          await route.fulfill({
            contentType: "application/javascript",
            body: await readFile(
              `node_modules/posthog-js/dist/${name}`,
              "utf8",
            ),
          });
          return;
        }
        if (["/i/v0/e/", "/e/", "/s/"].includes(url.pathname)) {
          const raw = request.postDataBuffer();
          if (raw) {
            const text =
              raw[0] === 0x1f && raw[1] === 0x8b
                ? gunzipSync(raw).toString()
                : raw.toString();
            const value = JSON.parse(text);
            const batch: CapturedEvent[] = Array.isArray(value)
              ? value
              : Array.isArray(value.batch)
                ? value.batch
                : [value];
            for (const event of batch)
              if (event.event === "$snapshot")
                event.properties.$snapshot_data = decodeReplay(
                  event.properties.$snapshot_data,
                );
            events.push(...batch);
          }
        }
        await route.fulfill({
          contentType: "application/json",
          headers: { "access-control-allow-origin": "*" },
          body: JSON.stringify(
            url.pathname.includes("/flags")
              ? {
                  featureFlags: {
                    "session-replay": telemetrySettings.replay,
                    "product-feedback": false,
                    "website-cta-copy": telemetrySettings.variant,
                  },
                  featureFlagPayloads: {},
                  errorsWhileComputingFlags: false,
                }
              : url.pathname.endsWith("/config")
                ? config
                : { status: 1 },
          ),
        });
      });
      await use({ events, requests, sentry });
      if (testInfo.status !== testInfo.expectedStatus)
        await testInfo.attach("telemetry", {
          body: JSON.stringify({ events, requests, sentry }, null, 2),
          contentType: "application/json",
        });
    },
    { auto: true },
  ],
});
export { expect };
