import Link from "next/link";
import { NotebookTools } from "./notebook-tools";
import styles from "./overview.module.css";

export function Features() {
  return (
    <section
      id="features"
      className={styles.features}
      aria-labelledby="features-heading"
    >
      <div className={`page-container ${styles.featureSpread}`}>
        <div>
          <h2 id="features-heading">Make more of your notes</h2>
          <dl className={styles.featureList}>
            <dt>Save notes</dt>
            <dd>
              Keep lecture notes, PDFs and short voice recordings together.
            </dd>
            <dt>Read and listen</dt>
            <dd>Transcribe a recording or hear your notes read aloud.</dd>
            <dt>Review edits</dt>
            <dd>Compare drafts or restore an earlier version.</dd>
            <dt>Share notes</dt>
            <dd>
              Send a read-only link you can turn off later, or export your
              library.
            </dd>
          </dl>
          <Link className={styles.link} href="/docs/notebook">
            Read the notebook guide
          </Link>
        </div>
        <NotebookTools />
      </div>
    </section>
  );
}
