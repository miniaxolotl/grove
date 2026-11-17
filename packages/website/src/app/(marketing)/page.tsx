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
                Private notes, easy to find
              </h1>
              <p className="hero-summary">
                Write notes, organize them in notebooks, and find them by word
                or meaning. Ask questions and open the notes behind each answer.
              </p>
              <div className="hero-actions">
                <Link
                  href="/sign-up"
                  className="button-primary"
                  data-analytics-event="cta_clicked"
                  data-analytics-placement="hero"
                >
                  <HeroCtaCopy />
                </Link>
                <a href="#your-library" className="text-link">
                  Explore an example
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
      <MemoryDemo />
      <HowItWorks />
      <Features />
      <AgentStory />
      <section className="feature-index" aria-labelledby="plans-heading">
        <div className="page-container product-facts" data-reveal>
          <h2 id="plans-heading" className="section-title">
            Free and Pro
          </h2>
          <div>
            <p>
              Start with notes, search, Ask Grove, and optional agent
              connections. Pro raises the limits for notes and AI use.
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
