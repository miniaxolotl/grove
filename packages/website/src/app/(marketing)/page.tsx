import {
  ArrowRight,
  BookOpen,
  Check,
  CirclePlay,
  MessageSquare,
  Network,
  NotebookPen,
} from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { GroveMark } from "@/components/brand";
import { FAQ } from "@/components/faq";
import { Features } from "@/components/features";
import { HowItWorks } from "@/components/how-it-works";
import { MemoryDemo } from "@/components/memory-demo";
import { MemoryPreview } from "@/components/memory-preview";
import { LibraryPreview } from "@/components/library-preview";
import { AgentStory } from "@/components/agent-story";
import { StructuredData } from "@/components/structured-data";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";
import { HeroCtaCopy } from "@/components/website-telemetry";

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
            <GroveMark className="size-5" /> YOUR PRIVATE NOTEBOOK
          </p>
          <h1 id="hero-heading" className="hero-heading">
            Good ideas.
            <br />
            <em>Room to grow.</em>
          </h1>
          <p className="mt-6 max-w-[420px] text-[15px] leading-[1.85] text-muted sm:text-base">
            Keep your notes, plans and journal in one private notebook. Find
            them again, even when you forget the exact words.
          </p>
          <p className="mt-3 text-xs leading-6 text-muted">
            Write in your browser. No install needed.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-up"
              className="button-primary"
              data-analytics-event="cta_clicked"
              data-analytics-placement="hero"
            >
              <HeroCtaCopy /> <ArrowRight size={16} />
            </Link>
            <a
              href="#your-library"
              className="inline-flex min-h-12 items-center gap-2 px-1 text-xs font-medium transition-colors hover:text-leaf"
            >
              <CirclePlay size={19} strokeWidth={1.3} /> Try the preview
            </a>
          </div>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[10px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-leaf" /> Notes and journals
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-leaf" /> Open in your browser
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Check size={12} className="text-leaf" /> Your notes, your control
            </span>
          </div>
        </div>
        <MemoryPreview />
      </section>

      <section
        className="border-y border-line bg-sage/40"
        aria-label="A place for your everyday ideas"
      >
        <div className="page-container flex flex-col items-center gap-6 py-6 lg:flex-row lg:justify-between">
          <p className="whitespace-nowrap text-[11px] font-medium text-muted">
            Your notes, in one place
          </p>
          <div className="grid w-full grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-4 lg:w-auto lg:gap-x-12">
            {[
              {
                icon: BookOpen,
                name: "Notes",
                detail: "Save an idea",
              },
              {
                icon: NotebookPen,
                name: "Journal",
                detail: "Keep a daily record",
              },
              {
                icon: MessageSquare,
                name: "Ask Grove",
                detail: "Find answers in your notes",
              },
              {
                icon: Network,
                name: "Connections",
                detail: "Explore related notes",
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

      <LibraryPreview />
      <Features />
      <MemoryDemo />
      <HowItWorks />
      <AgentStory />

      <FAQ />

      <section
        id="install"
        className="closing-section"
        aria-labelledby="closing-heading"
      >
        <div className="closing-rings" />
        <div className="page-container relative flex flex-col items-start justify-between gap-8 py-16 sm:py-20 md:flex-row md:items-center lg:py-24">
          <div>
            <p className="eyebrow flex items-center gap-2">
              <GroveMark className="size-5" /> START WRITING
            </p>
            <h2 id="closing-heading" className="section-heading mt-5">
              Your first note
              <br />
              <em>starts here.</em>
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-leaf">
              Create an account. Save an idea. Find it when you need it.
            </p>
          </div>
          <div className="relative z-10 flex flex-col items-start gap-4 md:items-center">
            <Link href="/sign-up" className="button-primary min-w-52">
              Start your notebook <ArrowRight size={17} />
            </Link>
            <Link
              href="/app"
              className="inline-flex min-h-11 items-center gap-2 text-xs text-forest hover:underline"
            >
              Already a member? Open your notebook
            </Link>
          </div>
        </div>
      </section>
      <section
        className="page-container media-kit"
        aria-labelledby="materials-heading"
      >
        <div>
          <p className="eyebrow">BRAND MATERIALS</p>
          <h2 id="materials-heading">Share Grove</h2>
          <p>Logos, artwork and a short description.</p>
        </div>
        <div className="media-kit-links">
          <a href="/materials/grove-media-kit.zip" download>
            Download media kit
          </a>
          <a href="/materials/about.txt" download>
            About Grove
          </a>
          <a href="/brand-kit/identity/primary/logos/horizontal.svg" download>
            Download logo
          </a>
        </div>
      </section>
      <StructuredData />
    </main>
  );
}
