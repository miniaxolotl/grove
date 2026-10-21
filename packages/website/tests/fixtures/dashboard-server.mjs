// Isolated browser fixture, never imported into the application or production auth.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const fixtureConfig = {
  entryPoints: [join(root, "tests/fixtures/dashboard.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  loader: { ".css": "empty" }, // Production CSS is linked below, including lazy graph styles.
  tsconfig: join(root, "tsconfig.json"),
  define: Object.fromEntries(
    [
      "DEPLOYMENT_ENVIRONMENT",
      "POSTHOG_ENABLED",
      "POSTHOG_KEY",
      "SENTRY_ENABLED",
      "SENTRY_DSN",
      "TELEMETRY_RELEASE",
      "APP_VERSION",
    ].map((key) => [`process.env.NEXT_PUBLIC_${key}`, '""']),
  ),
  plugins: [
    {
      name: "fixture-host",
      setup(build) {
        build.onResolve(
          { filter: /^(next\/(link|navigation|image|router)|@clerk\/nextjs)$/ },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "jsx",
          resolveDir: root,
          contents:
            args.path === "next/router"
              ? "export default { events: { on() {}, off() {} } };"
              : args.path === "next/link"
                ? 'export { FixtureLink as default } from "./tests/fixtures/navigation";'
                : args.path === "next/navigation"
                  ? 'export { usePathname, useRouter } from "./tests/fixtures/navigation";'
                  : args.path === "next/image"
                    ? 'import React from "react"; export default function Image({unoptimized, ...props}) { return <img {...props}/> }'
                    : 'import React from "react"; export const useUser = () => ({isLoaded:true,isSignedIn:true,user: {id: "fixture-user", firstName: "Alex"}}); export const RedirectToSignIn = () => <a href="/sign-in">Sign in</a>; export const UserButton = () => <button aria-label="Account" style={{borderRadius:"50%",background:"#e3eadf",width:32,height:32}}>A</button>; export const useClerk = () => ({signOut: async () => {}, openUserProfile: () => {}});',
        }));
      },
    },
  ],
};
const result = await build(fixtureConfig);
const pdfWorker = await build({
  entryPoints: [join(root, "src/lib/note-pdf.worker.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
});
const telemetryResult = await build({
  ...fixtureConfig,
  entryPoints: [join(root, "tests/fixtures/telemetry-dashboard.tsx")],
  define: Object.fromEntries(
    Object.entries({
      DEPLOYMENT_ENVIRONMENT: "production",
      POSTHOG_ENABLED: "true",
      POSTHOG_KEY: "phc_playwright_only",
      SENTRY_ENABLED: "true",
      SENTRY_DSN:
        "https://00000000000000000000000000000000@o0.ingest.us.sentry.io/1",
      TELEMETRY_RELEASE: "grove-website@fixture",
      APP_VERSION: "1.4.0",
    }).map(([key, value]) => [
      `process.env.NEXT_PUBLIC_${key}`,
      JSON.stringify(value),
    ]),
  ),
  plugins: [
    {
      name: "telemetry-account",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/nextjs$/ }, () => ({
          path: join(root, "tests/fixtures/telemetry-account.tsx"),
        }));
      },
    },
    ...fixtureConfig.plugins,
  ],
});
const css = (await readdir(join(root, ".next/static/chunks"))).filter((file) =>
  file.endsWith(".css"),
);
const fonts = [
  ...[400, 500, 600, 700].map((weight) => ({
    family: "Space Grotesk",
    file: `space-grotesk-${weight}.woff2`,
    weight,
  })),
  ...[400, 500].map((weight) => ({
    family: "JetBrains Mono",
    file: `jetbrains-mono-${weight}.woff2`,
    weight,
  })),
];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grove dashboard fixture</title>${css.map((file) => `<link rel="stylesheet" href="/_next/static/chunks/${file}">`).join("")}<style>${fonts.map(({ family, file, weight }) => `@font-face{font-family:'${family}';src:url('/fonts/${file}');font-weight:${weight}}`).join("")}body{--font-space-grotesk:'Space Grotesk';--font-jetbrains-mono:'JetBrains Mono'}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  try {
    if (path === "/brand-kit/fonts/jetbrains-mono-regular.ttf") {
      response
        .writeHead(200, { "Content-Type": "font/ttf" })
        .end(await readFile(join(root, "public", path)));
      return;
    }
    if (path === "/note-pdf.worker.ts") {
      response
        .writeHead(200, { "Content-Type": "application/javascript" })
        .end(pdfWorker.outputFiles[0].contents);
      return;
    }
    if (path === "/telemetry-fixture.js") {
      response
        .writeHead(200, { "Content-Type": "application/javascript" })
        .end(telemetryResult.outputFiles[0].contents);
      return;
    }
    if (path === "/fixture.js") {
      response
        .writeHead(200, { "Content-Type": "application/javascript" })
        .end(result.outputFiles[0].contents);
      return;
    }
    if (path.startsWith("/_next/static/")) {
      const file = resolve(root, ".next", path.slice(7));
      if (!file.startsWith(join(root, ".next/static/"))) throw new Error();
      response
        .writeHead(200, {
          "Content-Type": path.endsWith(".css") ? "text/css" : "font/woff2",
        })
        .end(await readFile(file));
      return;
    }
    if (path.startsWith("/fonts/")) {
      const file = fonts.find(({ file }) => path === `/fonts/${file}`)?.file;
      if (!file) throw new Error();
      response
        .writeHead(200, { "Content-Type": "font/woff2" })
        .end(await readFile(join(root, "public/brand-kit/fonts", file)));
      return;
    }
    if (
      (path.startsWith("/brand/") || path.startsWith("/brand-kit/")) &&
      path.endsWith(".svg")
    ) {
      const file = resolve(root, "public", path.slice(1));
      if (
        !file.startsWith(join(root, "public/brand/")) &&
        !file.startsWith(join(root, "public/brand-kit/"))
      )
        throw new Error();
      response
        .writeHead(200, { "Content-Type": "image/svg+xml" })
        .end(await readFile(file));
      return;
    }
    if (path.startsWith("/api/")) {
      response.writeHead(503).end();
      return;
    }
    const telemetryFixture = new URL(
      request.url,
      "http://localhost",
    ).searchParams.has("telemetry_fixture");
    response
      .writeHead(200, { "Content-Type": "text/html" })
      .end(
        telemetryFixture
          ? html.replace('src="/fixture.js"', 'src="/telemetry-fixture.js"')
          : html,
      );
  } catch {
    response.writeHead(404).end();
  }
}).listen(Number(process.env.DASHBOARD_TEST_PORT || 3101), "127.0.0.1");
