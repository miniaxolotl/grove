import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative overflow-hidden bg-forest text-paper"
      aria-labelledby="how-heading"
    >
      <div className="dark-rings" aria-hidden="true" />
      <div className="page-container section-space relative">
        <div className="section-intro">
          <div>
            <p className="eyebrow text-lime/75">GET STARTED</p>
            <h2 id="how-heading" className="section-heading mt-4">
              Open Grove.
              <br />
              <em className="text-lime!">Write your first note.</em>
            </h2>
          </div>
          <p className="text-paper/65!">
            Start in your browser. Organize as you go.
          </p>
        </div>

        <ol className="getting-started-steps">
          {[
            {
              number: "01",
              title: "Create an account.",
              description: "Sign up and open your private notebook.",
            },
            {
              number: "02",
              title: "Save a note.",
              description:
                "Write a plan, idea or journal entry. Group related pages into notebooks.",
            },
            {
              number: "03",
              title: "Find it again.",
              description:
                "Search by meaning or ask a question. Follow answers back to your notes.",
            },
          ].map(({ number, title, description }) => (
            <li key={number}>
              <span className="getting-started-number">{number}</span>
              <h3 className="mt-4 text-lg font-medium tracking-tight">
                {title}
              </h3>
              <p className="mt-3 text-[13px] leading-7 text-paper/65">
                {description}
              </p>
            </li>
          ))}
        </ol>
        <div className="optional-connection">
          <p>Use AI tools? They can work with your notebook, too.</p>
          <Link href="/install">
            Connect your AI tools <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
