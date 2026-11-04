import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="page-container story-section"
      aria-labelledby="how-heading"
    >
      <div className="section-lead" data-reveal>
        <h2 id="how-heading" className="section-title">
          Get started
        </h2>
        <p>
          Start in your browser. Connect other tools only when you want to take
          your notebook with you.
        </p>
      </div>
      <ol
        className="note-path"
        aria-label="Set up your Grove notebook"
        data-stagger
      >
        <li data-reveal>
          <h3>Open Grove</h3>
          <p>
            Sign in and start writing in your browser. You can create notebooks
            later; no install or agent connection is required.
          </p>
        </li>
        <li data-reveal>
          <h3>Save a first note</h3>
          <p>
            Choose New note, write something and wait for the saved
            confirmation. Reopen it from Notes to check that it is there.
          </p>
        </li>
        <li data-reveal>
          <h3>Check a first answer</h3>
          <p>
            Open Ask, select the note in Sources and ask about it. Open the
            citation to compare the answer with what you saved.
          </p>
        </li>
      </ol>
      <div className="note-path-caption">
        <Link className="text-link" href="/docs/notebook">
          Read the notebook guide <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
