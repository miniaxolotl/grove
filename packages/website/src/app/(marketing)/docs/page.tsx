import Link from "next/link";
import { documentation } from "@/content/documentation";
import { clientOptions } from "@/content/install";
import styles from "@/components/documentation-page.module.css";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata(
  "Grove documentation",
  "Save and find notes, connect your apps to Grove, or look up a memory tool and its API.",
  "/docs",
);

export default function DocsPage() {
  return (
    <main id="main" className={`page-container ${styles.page}`}>
      <header className={styles.heading}>
        <h1>Grove documentation</h1>
        <p>
          Start a notebook, connect a tool, or find a reference. Pick the task
          you need.
        </p>
      </header>
      <div className={styles.directory}>
        <section>
          <h2>Use your notebook</h2>
          <p>Write a note, ask a question, then check its source.</p>
          <ul>
            <li>
              <Link href="/docs/notebook#your-first-saved-note">
                Save your first note
              </Link>
            </li>
            <li>
              <Link href="/docs/ask-tools#controls-and-workflow">
                Ask a question about your notes
              </Link>
            </li>
            <li>
              <Link href="/docs/notebook#share-with-a-link">
                Share a note with a link
              </Link>
            </li>
          </ul>
        </section>
        <section>
          <h2>Connect an app</h2>
          <p>Optional connections, with access you choose and can revoke.</p>
          <ul className={styles.apps}>
            {clientOptions.map(({ value, label, guide }) => (
              <li key={value}>
                <Link href={guide}>{label}</Link>
              </li>
            ))}
          </ul>
          <Link href="/install#browser-extension">
            Install the browser extension
          </Link>
        </section>
        <section>
          <h2>Guides and reference</h2>
          <ul>
            {documentation.map(({ slug, title }) => (
              <li key={slug}>
                <Link href={`/docs/${slug}`}>{title}</Link>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2>Run or troubleshoot Grove</h2>
          <ul>
            <li>
              <Link href="/self-host">Set up a self-hosted server</Link>
            </li>
            <li>
              <Link href="/docs/client#diagnose-installation-and-startup">
                Diagnose an agent connection
              </Link>
            </li>
            <li>
              <Link href="/support">Contact support</Link>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
