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
            <dt>Capture a thought</dt>
            <dd>
              Write a note, bring in a PDF, or record a short voice note and
              transcribe it.
            </dd>
            <dt>See what changed</dt>
            <dd>
              Compare two versions of a note. Restore an earlier draft as a new
              revision without losing the edits in between.
            </dd>
            <dt>Share a copy or a link</dt>
            <dd>
              Export your library, or share a read-only link to a note or
              notebook. You can turn the link off later.
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
          <figcaption>Comparing two versions of a note in Grove.</figcaption>
        </figure>
      </div>
    </section>
  );
}
