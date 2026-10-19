import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CirclePlay,
  Code2,
  Database,
  Network,
  Sprout,
} from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { GroveMark } from "@/components/brand";
import { CopyButton } from "@/components/copy-button";
import { FAQ } from "@/components/faq";
import { Features } from "@/components/features";
import { GitHubIcon as Github } from "@/components/github-icon";
import { HowItWorks } from "@/components/how-it-works";
import { Installation } from "@/components/installation";
import { MemoryDemo } from "@/components/memory-demo";
import { MemoryPreview } from "@/components/memory-preview";
import { LibraryPreview } from "@/components/library-preview";
import { StructuredData } from "@/components/structured-data";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata(site.title, site.description, "/");

export default async function HomePage() {
  await connection();

  return (
    <main id="main">
      <section
        className="page-container hero-grid"
        aria-labelledby="hero-heading"
      >
        <div className="relative z-10 min-w-0">
          <p className="eyebrow flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-leaf" /> GROVE / AGENT
            MEMORY
          </p>
          <h1 id="hero-heading" className="hero-heading">
            New session.
            <br />
            <em>Same context.</em>
          </h1>
          <p className="mt-6 max-w-[420px] text-[15px] leading-[1.85] text-muted sm:text-base">
            Stop re-explaining the way you work. Keep decisions, preferences,
            and hard-won fixes with you across agents, projects, and sessions.
            All in{" "}
            <span className="font-medium text-forest">
              one private memory account.
            </span>
          </p>
          <p className="mt-3 text-xs leading-6 text-muted">
            Less starting over. More getting somewhere.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/sign-up" className="button-primary">
              Start remembering <ArrowRight size={16} />
            </Link>
            <a
              href="#memory-in-action"
              className="inline-flex min-h-12 items-center gap-2 px-1 text-xs font-medium transition-colors hover:text-leaf"
            >
              <CirclePlay size={19} strokeWidth={1.3} /> See it in action
            </a>
          </div>
          <div className="mt-6 flex w-fit max-w-full flex-wrap items-center gap-x-4 rounded-lg border border-line bg-white/40 px-3 py-0.5">
            <code className="min-w-0 py-2 font-mono text-[10px] text-muted sm:text-[11px]">
              <span className="mr-2 select-none text-leaf">$</span>npm i -g
              @miniaxolotl/grove
            </code>
            <CopyButton
              text="npm i -g @miniaxolotl/grove"
              label="Copy npm install command"
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-leaf" /> Open source
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-leaf" /> Hosted or self-hosted
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-leaf" /> Private to your account
            </span>
          </div>
        </div>
        <MemoryPreview />
      </section>

      <section
        className="border-y border-line bg-sage/40"
        aria-label="Built on open foundations"
      >
        <div className="page-container flex flex-col items-center gap-6 py-6 lg:flex-row lg:justify-between">
          <p className="whitespace-nowrap font-mono text-[9px] tracking-wider text-muted">
            BUILT FOR YOUR STACK
          </p>
          <div className="grid w-full grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-4 lg:w-auto lg:gap-x-12">
            {[
              {
                icon: Code2,
                name: "OpenCode",
                detail: "Plugin + memory tools",
              },
              {
                icon: Code2,
                name: "Claude Code",
                detail: "Tools + optional hooks",
              },
              {
                icon: Database,
                name: "Codex",
                detail: "Your next task, with context",
              },
              {
                icon: Network,
                name: "MCP",
                detail: "HTTP & stdio transport",
              },
            ].map(({ icon: Icon, name, detail }) => (
              <div key={name} className="flex items-center gap-3">
                <Icon
                  size={22}
                  strokeWidth={1.4}
                  className="shrink-0 text-leaf"
                />
                <div>
                  <p className="text-sm font-medium tracking-tight">{name}</p>
                  <p className="mt-0.5 text-[9px] text-muted">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <MemoryDemo />
      <LibraryPreview />
      <Features />
      <HowItWorks />

      <section
        id="install"
        className="page-container section-space"
        aria-labelledby="install-heading"
      >
        <div className="section-intro mb-0!">
          <div>
            <p className="eyebrow">QUICKSTART</p>
            <h2 id="install-heading" className="section-heading mt-4">
              Add memory
              <br />
              <em>to your stack.</em>
            </h2>
          </div>
          <div className="max-w-[310px]">
            <p className="text-[13px] leading-7 text-muted">
              Create your Grove account, connect an agent, and save your first
              project decision.
            </p>
            <Link
              href="/install"
              className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs font-medium text-leaf hover:underline"
            >
              Open the installation guide <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
        <Installation />
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-sage/30 px-5 py-4 sm:px-7">
          <p className="flex items-start gap-3 text-xs leading-6 text-muted">
            <Sprout size={19} className="mt-0.5 shrink-0 text-leaf" />
            <span>
              Start with hosted Grove, or run the API, worker, and PostgreSQL on
              your own infrastructure. Your choice, the same four tools.
            </span>
          </p>
          <a
            href={site.deployDocs}
            className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-leaf hover:underline"
          >
            Deployment reference <ArrowUpRight size={14} />
          </a>
        </div>
      </section>

      <FAQ />

      <section className="closing-section" aria-labelledby="closing-heading">
        <div className="closing-rings" />
        <div className="page-container relative flex flex-col items-start justify-between gap-8 py-16 sm:py-20 md:flex-row md:items-center lg:py-24">
          <div>
            <p className="eyebrow flex items-center gap-2">
              <GroveMark className="size-5" /> BUILT FOR DEVELOPERS. BY BRAMBLE
              LABS INC.
            </p>
            <h2 id="closing-heading" className="section-heading mt-5">
              Keep the context.
              <br />
              <em>Keep building.</em>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-leaf">
              Give your next session the decisions, preferences, and fixes you
              already worked out.
            </p>
          </div>
          <div className="relative z-10 flex flex-col items-start gap-4 md:items-center">
            <a href="#install" className="button-primary min-w-52">
              Install Grove <ArrowDown size={17} />
            </a>
            <a
              href={site.github}
              className="inline-flex min-h-11 items-center gap-2 text-xs text-forest hover:underline"
            >
              <Github size={15} /> Explore on GitHub <ArrowUpRight size={13} />
            </a>
            <span className="font-mono text-[9px] text-leaf">
              OPEN SOURCE · PRIVATE MEMORY · MIT LICENSED
            </span>
          </div>
        </div>
      </section>
      <StructuredData />
    </main>
  );
}
