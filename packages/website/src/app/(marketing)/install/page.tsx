import { ArrowLeft, ArrowUpRight, BookOpen, Terminal } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Installation } from "@/components/installation";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(
  "Install Grove — Give your agent a memory",
  "Install Grove with Docker or npm, connect your MCP client, and save your first memory. A complete guide to self-hosted AI memory.",
  "/install",
);

export default async function InstallPage() {
  await connection();

  return (
    <main id="main" className="page-container pb-20 pt-9 md:pb-28 md:pt-12">
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2 text-xs text-leaf hover:underline"
      >
        <ArrowLeft size={14} /> Back to Grove
      </Link>
      <div className="mt-9 max-w-2xl">
        <p className="eyebrow">THE INSTALLATION GUIDE</p>
        <h1 className="section-heading mt-4 text-[56px]! sm:text-[72px]!">
          A home for your
          <br />
          <em>agent’s memory.</em>
        </h1>
        <p className="mt-6 max-w-lg text-sm leading-7 text-muted">
          Start your server, connect an agent, and save something worth
          remembering. Here’s everything you need to put down the first roots.
        </p>
      </div>
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 border-y border-line py-5 text-xs text-leaf">
        <span className="flex items-center gap-2">
          <Terminal size={14} /> Node.js 22+ for clients · Node.js 24 for
          hosting
        </span>
        <span className="flex items-center gap-2">
          <BookOpen size={14} /> An MCP-compatible client
        </span>
      </div>
      <Installation />
      <section
        className="mt-6 rounded-xl border border-line bg-sage/50 p-6 sm:p-8"
        aria-labelledby="next-heading"
      >
        <h2 id="next-heading" className="text-xl font-medium tracking-tight">
          Ready to grow from here?
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
          Explore the four memory tools, manage connections in your dashboard,
          or set up Grove on your own server.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2">
          {[
            { label: "Server & tool reference", href: site.docs },
            { label: "OpenCode plugin", href: site.pluginDocs },
            { label: "Deployment guide", href: site.deployDocs },
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
