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
    "Restore earlier revisions, archive old notes and export your library. Choose each connected agent's notebook access and revoke it when you're done.",
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
        <div className="feature-photo" data-reveal>
          <Image
            src="/images/kit/grove-journal.webp"
            alt="An open handwritten journal by a window"
            width={640}
            height={960}
            sizes="(max-width: 767px) calc(100vw - 40px), 40vw"
          />
        </div>
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
