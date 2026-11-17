import Link from "next/link";

const features = [
  [
    "Import and share",
    "Bring in notes and PDFs. Share a read-only link to a note or notebook and turn it off when you need to.",
  ],
  [
    "Revision history and export",
    "Compare and restore earlier versions, archive notes you no longer need, and export your library.",
  ],
  [
    "Voice notes and read aloud",
    "Record and transcribe a short voice note, or listen to a saved note instead of reading it.",
  ],
  [
    "Browser extension",
    "Check spelling and grammar on your device, and save or find notes from the browser panel. Install locally in Chrome, Firefox, or Edge.",
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
            What you can do with Grove
          </h2>
        </div>
        <dl className="feature-list" data-stagger>
          {features.map(([title, description]) => (
            <div className="feature-row" key={title} data-reveal>
              <dt>{title}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <Link className="text-link" href="/docs/notebook">
          Read the notebook guide
        </Link>
      </div>
    </section>
  );
}
