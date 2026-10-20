import {
  ArrowUpRight,
  Network,
  LockKeyhole,
  Search,
  NotebookPen,
} from "lucide-react";
import Link from "next/link";
import { IdeaMap } from "@/components/idea-map";

export function Features() {
  return (
    <section
      id="features"
      className="page-container section-space"
      aria-labelledby="features-heading"
    >
      <div className="section-intro">
        <div>
          <p className="eyebrow">LESS TO JUGGLE. MORE TO DISCOVER.</p>
          <h2 id="features-heading" className="section-heading mt-4">
            Keep the thought.
            <br />
            <em>Find the possibility.</em>
          </h2>
        </div>
        <p>
          A calmer place for the things on your mind, with a little help finding
          your way back to them.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        <article className="feature-card bg-white/60" data-reveal>
          <span className="feature-icon">
            <Search size={20} />
          </span>
          <h3>
            Remember the idea.
            <br />
            Find it in your own words.
          </h3>
          <p>
            You don’t have to remember the exact phrase. Describe what you’re
            looking for, and Grove helps you find the note behind the thought.
          </p>
          <div
            className="search-illustration"
            aria-label="Example search finding a saved travel plan"
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
              <Search size={14} />
              <span>That quiet place I wanted to stay?</span>
              <span className="ml-auto rounded border border-line px-1.5 font-mono text-[9px]">
                ↵
              </span>
            </div>
            <div className="m-3 rounded-md border border-leaf/20 bg-sage/50 px-3 py-3">
              <div className="mb-2 flex items-center justify-between text-[9px]">
                <span className="text-leaf">FROM YOUR NOTES</span>
                <span className="text-muted">Japan trip</span>
              </div>
              <p className="text-xs! leading-6! text-forest!">
                A small guesthouse near the river in Kyoto. Four nights, with
                time for gardens and neighborhood cafés.
              </p>
            </div>
          </div>
        </article>

        <article className="feature-card bg-white/60" data-reveal>
          <span className="feature-icon">
            <Network size={20} />
          </span>
          <h3>
            A new way to
            <br />
            see the bigger picture.
          </h3>
          <p>
            Grove finds connections between related notes. Explore them as a map
            of your ideas, and discover what you might want to think about next.
          </p>
          <IdeaMap />
        </article>

        <article className="feature-card bg-white/60" data-reveal>
          <span className="feature-icon">
            <LockKeyhole size={20} />
          </span>
          <h3>
            Your notebook.
            <br />
            Your say.
          </h3>
          <p>
            Change your mind, edit a detail, or bring an earlier version back.
            Keep notes for as long as you need them, and export or delete them
            when you choose.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Private notebook", "Earlier versions", "Export your notes"].map(
              (label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-leaf/20 px-3 py-1.5 text-[10px] text-leaf"
                >
                  <span className="size-1 rounded-full bg-leaf" />
                  {label}
                </span>
              ),
            )}
          </div>
        </article>

        <article className="feature-card bg-white/60" data-reveal>
          <span className="feature-icon">
            <NotebookPen size={20} />
          </span>
          <h3>
            A page for
            <br />
            what’s on your mind.
          </h3>
          <p>
            A small win. A fresh perspective. A day you want to remember. Your
            journal keeps your own words together, ready to revisit whenever you
            feel like it.
          </p>
          <div className="journal-illustration">
            <span>Today</span>
            <p>Made time for something I love. A good place to start.</p>
            <small>Your words, in your own time.</small>
          </div>
        </article>
      </div>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-y border-line py-5 text-xs">
        <p className="text-muted">
          <span className="font-medium text-forest">
            A notebook that’s yours.
          </span>{" "}
          You choose what to keep and which connected tools can access it.
        </p>
        <Link
          href="/privacy"
          className="inline-flex min-h-8 items-center gap-2 font-medium text-forest hover:underline"
        >
          Read our privacy policy <ArrowUpRight size={14} />
        </Link>
      </div>
    </section>
  );
}
