import { ArrowLeft, ArrowUpRight, BookOpen, Terminal } from "lucide-react";
import Link from "next/link";
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
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 text-xs text-leaf hover:underline"
      >
        <ArrowLeft size={14} /> Back to Grove
      </Link>
      <div className="setup-intro">
        <h1 className="setup-heading">
          Connect your
          <br />
          AI tools.
        </h1>
        <p>
          Choose a client, approve its access and verify a first saved note. You
          can keep using the browser notebook without connecting a tool.
        </p>
      </div>
      <div className="setup-prerequisites">
        <span className="flex items-center gap-2">
          <Terminal size={14} /> Node.js 22+ for terminal clients only
        </span>
        <span className="flex items-center gap-2">
          <BookOpen size={14} /> An MCP-compatible client
        </span>
      </div>
      <Installation />
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
