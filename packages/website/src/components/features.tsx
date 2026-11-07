import Image from "next/image";

const features = [
  [
    "Voice notes and read aloud",
    "Record a short voice note and transcribe it. Listen to notes with read aloud when you would rather step away from the screen.",
  ],
  [
    "Imports and sharing",
    "Import notes or PDFs, review the proposed pages and choose where they go. Share a read-only link to a note or notebook, and revoke it when you need to.",
  ],
  [
    "History and export",
    "Restore earlier revisions, compare before and after with grouped diffs, archive old notes and export your library. Choose each connected agent's notebook access and revoke it when you're done.",
  ],
  [
    "Browser extension",
    "Save notes from any tab and search your library in Chrome, Firefox or Edge. Spelling and grammar checks run locally; optional sentence-level AI rewrites need your explicit consent. Locally installable, not a store listing.",
  ],
] as const;

export function Features() {
  return (
    <section
      id="features"
      className="feature-index"
      aria-labelledby="features-heading"
    >
      <div className="page-container feature-index-layout">
        <div className="feature-index-heading" data-reveal>
          <h2 id="features-heading" className="section-title">
            More ways to use your notes
          </h2>
          <p>
            Write at your own pace, bring in what you already have and decide
            what to share.
          </p>
        </div>
        <figure className="feature-photo" data-reveal>
          <Image
            src="/images/marketing/editorial.webp"
            alt="Editorial notebook illustration showing an earlier draft beside a person writing by a window."
            width={1600}
            height={1000}
            sizes="(max-width: 767px) calc(100vw - 40px), 40vw"
          />
          <figcaption>
            Illustrative note history. Your earlier drafts stay within reach.{" "}
            <a href="/images/marketing/CREDITS.md">Photo credits</a>.
          </figcaption>
        </figure>
        <dl className="feature-list" data-stagger>
          {features.map(([title, description]) => (
            <div className="feature-row" key={title} data-reveal>
              <dt>{title}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
