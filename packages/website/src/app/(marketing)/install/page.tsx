import Link from "next/link";
import { connection } from "next/server";
import { Installation } from "@/components/installation";
import { ExtensionStoreLinks } from "@/components/extension-store-links";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Grove integrations | Browser and AI tools",
  "Use the browser extension or connect an AI tool. Both are optional; choose and revoke access to your notes.",
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
          <a href="#browser-extension">Browser extension setup</a>
          <a href="#ai-tools">AI tool setup</a>
        </nav>
      </header>
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
        <p className="mt-3 max-w-2xl text-base leading-7">
          Check spelling and grammar on your device in Chrome, Edge or Firefox.
          Sign in to save and search notes. Optional sentence rewrites require
          your consent.
        </p>
        <ExtensionStoreLinks />
        <p className="mt-2 max-w-2xl text-base leading-7">
          For a local Chrome installation, choose a browser ZIP from the{" "}
          <a
            className="underline"
            href="https://github.com/miniaxolotl/grove/releases"
          >
            release assets
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
      <section aria-labelledby="ai-tools" className="setup-tools max-w-[68ch]">
        <h2 id="ai-tools">Connect an AI tool</h2>
        <Installation />
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
