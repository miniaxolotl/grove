import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

export type LegalDocument = {
  title: string;
  summary: string;
  sections: { id: string; title: string; content: ReactNode }[];
};

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <main id="main" className="page-container legal-page">
      <Link href="/" className="legal-back">
        <ArrowLeft size={14} aria-hidden="true" /> Back to Grove
      </Link>
      <header className="legal-heading">
        <p className="eyebrow">GROVE / BRAMBLE LABS INC.</p>
        <h1>{document.title}</h1>
        <p>{document.summary}</p>
        <span>Effective October 19, 2026</span>
      </header>
      <div className="legal-layout">
        <nav className="legal-contents" aria-label="On this page">
          <p>IN THIS DOCUMENT</p>
          <ol>
            {document.sections.map(({ id, title }, index) => (
              <li key={id}>
                <a href={`#${id}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="legal-body">
          {document.sections.map(({ id, title, content }, index) => (
            <section id={id} key={id}>
              <h2>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {title}
              </h2>
              {content}
            </section>
          ))}
          <aside className="legal-contact">
            <p>Questions about your information or these terms?</p>
            <a href="mailto:grove@mawa.dev">
              grove@mawa.dev <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </aside>
          <nav className="legal-related" aria-label="Related policies">
            <Link href="/privacy">Privacy policy</Link>
            <Link href="/terms">Terms & conditions</Link>
          </nav>
        </article>
      </div>
    </main>
  );
}
