// Isolated browser fixture, never imported into the application or production auth.
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";
import { URL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const result = await build({
  entryPoints: [join(root, "tests/fixtures/dashboard.tsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  tsconfig: join(root, "tsconfig.json"),
  plugins: [
    {
      name: "fixture-host",
      setup(build) {
        build.onResolve(
          { filter: /^(next\/(link|navigation)|@clerk\/nextjs)$/ },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "jsx",
          resolveDir: root,
          contents:
            args.path === "next/link"
              ? 'import React from "react"; export default function Link(props) { return <a {...props}/> }'
              : args.path === "next/navigation"
                ? "export const usePathname = () => window.location.pathname;"
                : 'import React from "react"; export const useUser = () => ({user: {id: "fixture-user", firstName: "Alex"}}); export const UserButton = () => <button aria-label="Account" style={{borderRadius:"50%",background:"#e3eadf",width:32,height:32}}>A</button>; export const useClerk = () => ({signOut: async () => {}, openUserProfile: () => {}});',
        }));
      },
    },
  ],
});
const css = (await readdir(join(root, ".next/static/chunks"))).filter((file) =>
  file.endsWith(".css"),
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grove dashboard fixture</title>${css.map((file) => `<link rel="stylesheet" href="/_next/static/chunks/${file}">`).join("")}<style>@font-face{font-family:DM Sans;src:url('/fonts/sans.woff2')}@font-face{font-family:Instrument Serif;src:url('/fonts/serif.woff2')}body{--font-dm-sans:'DM Sans';--font-instrument-serif:'Instrument Serif'}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  try {
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
      const file = path.endsWith("sans.woff2")
        ? "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2"
        : "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2";
      response
        .writeHead(200, { "Content-Type": "font/woff2" })
        .end(await readFile(join(root, "node_modules", file)));
      return;
    }
    if (path.startsWith("/api/")) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" }).end(html);
  } catch {
    response.writeHead(404).end();
  }
}).listen(Number(process.env.DASHBOARD_TEST_PORT || 3101), "127.0.0.1");
