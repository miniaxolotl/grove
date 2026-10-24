import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";
import { faqs } from "@/content/site";

export function FAQ() {
  return (
    <section
      id="faq"
      className="border-t border-line bg-sage/30"
      aria-labelledby="faq-heading"
    >
      <div className="page-container section-space grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-20">
        <div>
          <p className="eyebrow">QUESTIONS</p>
          <h2 id="faq-heading" className="section-heading mt-4">
            Common questions.
          </h2>
          <Link
            href="/support"
            className="mt-5 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-leaf hover:underline"
          >
            Ask us a question <ArrowUpRight size={14} />
          </Link>
        </div>
        <div className="border-t border-line">
          {faqs.map(({ question, answer }) => (
            <details
              key={question}
              className="faq-item group border-b border-line"
            >
              <summary className="flex min-h-17 cursor-pointer list-none items-center justify-between gap-5 py-5 text-[14px] font-medium transition-colors hover:text-leaf">
                {question}
                <Plus
                  size={17}
                  className="shrink-0 text-leaf transition-transform group-open:rotate-45"
                />
              </summary>
              <p className="max-w-xl pb-6 pr-7 text-[13px] leading-7 text-muted">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
