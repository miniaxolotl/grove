import Link from "next/link";
import { connection } from "next/server";
import { FAQ } from "@/components/faq";
import { Features } from "@/components/features";
import { MemoryPreview } from "@/components/memory-preview";
import { StructuredData } from "@/components/structured-data";
import { HeroCtaCopy } from "@/components/website-telemetry";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";
import styles from "@/components/overview.module.css";

export const metadata = pageMetadata(site.title, site.description, "/");

export default async function HomePage() {
  await connection();
  return (
    <main id="main" className={`notebook-home ${styles.overview}`}>
      <section className={styles.opening} aria-labelledby="hero-heading">
        <div className={`page-container ${styles.intro}`}>
          <h1 id="hero-heading">Private notes, easy to find</h1>
          <div>
            <p>Search your notes or ask Grove a question.</p>
            <div className={styles.actions}>
              <Link
                href="/sign-up"
                className="button-primary"
                data-analytics-event="cta_clicked"
                data-analytics-placement="hero"
              >
                <HeroCtaCopy />
              </Link>
              <a href="#your-library" className={styles.link}>
                Explore an example
              </a>
            </div>
          </div>
        </div>
        <div className="page-container" id="your-library">
          <div className={styles.stage}>
            <MemoryPreview />
          </div>
          <Link href="/examples" prefetch={false} className={styles.link}>
            More notebook examples
          </Link>
        </div>
      </section>
      <Features />
      <section
        id="how-it-works"
        aria-labelledby="for-developers"
        className={styles.setup}
      >
        <div className={`page-container ${styles.setupGrid}`}>
          <h2 id="for-developers">Get started</h2>
          <div>
            <h3>Write without an account</h3>
            <p>
              Paste a paragraph to check spelling and grammar on your device.
            </p>
            <Link href="/writing" className={styles.link}>
              Try writing checks
            </Link>
          </div>
          <div>
            <h3>Use Grove in other tools</h3>
            <p>
              Save a page from your browser or give an AI client access to your
              notebook.
            </p>
            <div className={styles.links}>
              <Link href="/install#browser-extension" className={styles.link}>
                Browser extension setup
              </Link>
              <Link href="/install" className={styles.link}>
                Connect your AI tools
              </Link>
            </div>
          </div>
          <div>
            <h3>Choose a plan</h3>
            <p>
              Start on Free. See Pro limits and the terms of the optional
              seven-day trial.
            </p>
            <Link href="/pricing" className={styles.link}>
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
