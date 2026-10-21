import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Network, LockKeyhole } from "lucide-react";
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
          <p className="eyebrow">WHAT YOU CAN DO</p>
          <h2 id="features-heading" className="section-heading mt-4">
            Write, organize
            <br />
            <em>and find your notes.</em>
          </h2>
        </div>
        <p>Keep a journal, search by meaning and explore related ideas.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        <article className="feature-card bg-white/60" data-reveal>
          <h3>Search in your own words.</h3>
          <p>
            Describe the idea. Grove finds related notes, even without an exact
            keyword match.
          </p>
          <Image
            className="campaign-illustration"
            src="/materials/note-search.svg"
            alt="Example: a search for a quiet place by the river finds a saved Kyoto guesthouse note."
            width={900}
            height={520}
            sizes="(max-width: 767px) 100vw, 50vw"
          />
        </article>
        <article className="feature-card bg-white/60" data-reveal>
          <h3>Make a note of your day.</h3>
          <p>
            Keep a journal beside your plans, lists and ideas. Organize them
            into notebooks.
          </p>
          <Image
            className="campaign-illustration"
            src="/materials/journal.svg"
            alt="Example journal entry with a walk, coffee with a friend and a thought to keep."
            width={900}
            height={520}
            sizes="(max-width: 767px) 100vw, 50vw"
          />
        </article>
        <article className="feature-card bg-white/60" data-reveal>
          <span className="feature-icon">
            <Network size={20} aria-hidden="true" />
          </span>
          <h3>See how ideas connect.</h3>
          <p>View related notes on a map and open them to read more.</p>
          <IdeaMap />
        </article>
        <article className="feature-card bg-white/60" data-reveal>
          <span className="feature-icon">
            <LockKeyhole size={20} aria-hidden="true" />
          </span>
          <h3>Keep control of your notes.</h3>
          <p>
            Edit, restore earlier versions and export your notes. Choose which
            connected tools can access them.
          </p>
          <Link href="/sign-up" className="button-primary mt-7">
            Start your notebook <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <p>
            <Link href="/privacy" className="underline underline-offset-4">
              Read our privacy policy
            </Link>
          </p>
        </article>
      </div>
      <p className="mt-5 text-xs text-muted">
        Illustrated examples with sample notes.
      </p>
    </section>
  );
}
