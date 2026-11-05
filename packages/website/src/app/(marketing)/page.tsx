import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
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
    <main id="main" className="product-redesign notebook-home">
      <div className="hero-field">
        <section
          className="page-container product-hero"
          aria-labelledby="hero-heading"
        >
          <div className="notebook-spread">
            <div className="product-hero-copy notebook-invitation">
              <h1 id="hero-heading" className="hero-title">
                A home for
                <br />
                your notes.
              </h1>
              <p className="hero-summary">
                Write things down, find them again and ask questions with
                answers linked to your notes.
              </p>
              <div className="hero-actions">
                <Link
                  href="/sign-up"
                  className="button-primary"
                  data-analytics-event="cta_clicked"
                  data-analytics-placement="hero"
                >
                  <HeroCtaCopy />
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
                <a href="#your-library" className="text-link">
                  Try the notebook
                </a>
              </div>
            </div>
            <div className="product-stage notebook-leaf" data-reveal>
              <MemoryPreview />
            </div>
          </div>
        </section>
      </div>
      <LibraryPreview />
      <Features />
      <MemoryDemo />
      <HowItWorks />
      <AgentStory />
      <section className="feature-index" aria-labelledby="plans-heading">
        <div className="page-container product-facts" data-reveal>
          <h2 id="plans-heading" className="section-title">
            Free to start.
          </h2>
          <div>
            <p>
              Free includes writing, search, Ask Grove and optional agent
              connections, with clear usage allowances and no trial countdown.
            </p>
            <p>
              Need more room for notes and AI work? Pro increases the limits
              without changing how you work.
            </p>
            <Link href="/pricing" className="text-link">
              Compare Free and Pro
            </Link>
          </div>
        </div>
      </section>
      <FAQ />
      <StructuredData />
    </main>
  );
}
