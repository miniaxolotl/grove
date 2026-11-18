import Link from "next/link";
import { connection } from "next/server";
import { Installation } from "@/components/installation";
import { ExtensionStoreLinks } from "@/components/extension-store-links";
import { pageMetadata } from "@/lib/metadata";

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
          <a href="#browser-extension">Browser extension setup</a>
        </nav>
      </header>
      <section aria-labelledby="ai-tools" className="setup-tools max-w-[68ch]">
        <h2 id="ai-tools">Connect an AI tool</h2>
        <Installation />
      </section>
      <section
        id="browser-extension"
        className="setup-reference"
        aria-labelledby="extension-heading"
      >
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
        <ExtensionStoreLinks />
        <p className="mt-2 max-w-2xl text-sm leading-7">
          To install locally in Chrome, download the{" "}
          <a
            className="underline"
            href="https://github.com/miniaxolotl/grove/releases/download/v1.11.21/grove-chrome.zip"
          >
            unsigned Chrome ZIP (v1.11.21)
          </a>{" "}
          and follow the{" "}
          <a
            className="underline"
            href="https://github.com/miniaxolotl/grove/blob/HEAD/documentation/browser-extension.md"
          >
            extension setup guide
          </a>
          .
        </p>
      </section>
      <nav className="setup-jump" aria-label="Related setup guides">
        <Link href="/docs/server#memory-and-notebook-tools">
          Memory tool reference
        </Link>
        <Link
          href="/self-host"
          data-analytics-event="docs_link_clicked"
          data-analytics-placement="install"
        >
          Install Grove Open Source
        </Link>
      </nav>
    </main>
  );
}
