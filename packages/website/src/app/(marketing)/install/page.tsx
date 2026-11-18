import { ArrowUpRight } from "lucide-react";
import { connection } from "next/server";
import { Installation } from "@/components/installation";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(
  "Connect your AI tools to Grove",
  "Use Grove in ChatGPT or Claude web, or connect OpenCode, Claude Code and Codex. Sign in and choose which notes each tool can use.",
  "/install",
);

export default async function InstallPage() {
  await connection();

  return (
    <main id="main" className="page-container setup-page">
      <header className="setup-intro">
        <h1 className="setup-heading">Set up Grove</h1>
        <p>
          Connect an AI tool or install the browser extension. Both are optional
          if you use Grove on the web.
        </p>
        <nav className="setup-jump" aria-label="Setup options">
          <a href="#ai-tools">AI tool setup</a>
          <a href="#extension-heading">Browser extension setup</a>
        </nav>
      </header>
      <section aria-labelledby="ai-tools" className="setup-tools">
        <h2 id="ai-tools">Connect an AI tool</h2>
        <Installation />
      </section>
      <section className="setup-reference" aria-labelledby="extension-heading">
        <h2
          id="extension-heading"
          className="text-xl font-semibold tracking-tight"
        >
          Browser extension
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7">
          Check spelling and grammar on your device in Chrome, Edge or Firefox.
          Sign in to save and search notes. Optional sentence rewrites require
          your consent.
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-7">
          Install Grove from the Firefox or Edge store. For Chrome, follow the
          extension setup guide to load the unsigned package. The guide also
          covers local installation in Firefox and Edge.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
          {[
            {
              label: "Firefox Add-ons",
              href: "https://addons.mozilla.org/en-US/firefox/addon/grove-private-notes/",
            },
            {
              label: "Microsoft Edge Add-ons",
              href: "https://microsoftedge.microsoft.com/addons/detail/epmjpecpdnjbgbjnjkfjafonocecffmo",
            },
            {
              label: "Extension setup guide",
              href: "https://github.com/miniaxolotl/grove/blob/HEAD/documentation/browser-extension.md",
            },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-leaf hover:underline"
            >
              {label} <ArrowUpRight size={14} />
            </a>
          ))}
        </div>
      </section>
      <section className="setup-reference" aria-labelledby="next-heading">
        <h2 id="next-heading" className="text-xl font-medium tracking-tight">
          Documentation and self-hosting
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7">
          Explore the memory and notebook tools, manage connections in your
          dashboard, or set up Grove on your own server.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
          {[
            { label: "Server & tool reference", href: site.docs },
            { label: "OpenCode plugin", href: site.pluginDocs },
            { label: "Self-host Grove", href: "/self-host" },
          ].map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="inline-flex min-h-11 items-center gap-2 text-xs font-medium text-leaf hover:underline"
            >
              {label} <ArrowUpRight size={14} />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
