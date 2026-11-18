import Image from "next/image";
import Link from "next/link";
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
          <h2 id="features-heading">Work with your notes</h2>
          <dl className={styles.featureList}>
            <dt>Save notes</dt>
            <dd>Write, import a PDF, or record a voice note.</dd>
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
        <figure className={styles.revision}>
          <picture>
            <source
              media="(max-width: 599px)"
              srcSet="/images/marketing/revision-review-phone.webp"
              width={340}
              height={345}
            />
            <Image
              src="/images/marketing/revision-review.webp"
              width={640}
              height={510}
              sizes="(min-width: 800px) 44vw, 90vw"
              alt="Revision history comparing two versions: ‘working’ is crossed out and ‘tested’ is underlined."
            />
          </picture>
        </figure>
      </div>
    </section>
  );
}
