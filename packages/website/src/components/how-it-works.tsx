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
            <p className="eyebrow text-lime/75">START SMALL. MAKE IT YOURS.</p>
            <h2 id="how-heading" className="section-heading mt-4">
              A few words.
              <br />
              <em className="text-lime!">A little more clarity.</em>
            </h2>
          </div>
          <p className="text-paper/65!">
            No perfect system to set up. Just open your notebook and start with
            what’s on your mind.
          </p>
        </div>

        <ol className="getting-started-steps">
          {[
            {
              number: "01",
              title: "Open a little space.",
              description:
                "Create your account and open Grove in your browser. Your notebook is ready for a first thought.",
            },
            {
              number: "02",
              title: "Keep what matters.",
              description:
                "Write a note, make a plan, or add a journal entry. Give related ideas a notebook of their own.",
            },
            {
              number: "03",
              title: "Find your next thought.",
              description:
                "Search in your own words, ask Grove a question, or explore the connections between your notes.",
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
