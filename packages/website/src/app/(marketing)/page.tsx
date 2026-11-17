import Link from "next/link";
import { connection } from "next/server";
import { FAQ } from "@/components/faq";
import { Features } from "@/components/features";
import { MemoryPreview } from "@/components/memory-preview";
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
            <div
              id="your-library"
              className="product-stage notebook-leaf"
              data-reveal
            >
              <MemoryPreview />
            </div>
          </div>
        </section>
      </div>
      <section
        id="how-it-works"
        className="feature-index"
        aria-labelledby="for-developers"
      >
        <div className="page-container product-facts">
          <h2 id="for-developers" className="section-title">
            Get started
          </h2>
          <div>
            <p>
              Write your first note in the browser. Add the extension or connect
              AI tools whenever you need them.
            </p>
            <ul className="home-resource-links">
              <li>
                <Link href="/install#extension-heading" className="text-link">
                  Browser extension setup
                </Link>
              </li>
              <li>
                <Link href="/install" className="text-link">
                  Connect your AI tools
                </Link>
              </li>
              <li>
                <Link href="/examples" className="text-link" prefetch={false}>
                  More notebook examples
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
      <Features />
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
