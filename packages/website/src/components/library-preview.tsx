"use client";

import {
  ArrowUpRight,
  Check,
  NotebookPen,
  Network,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tabs } from "@/components/tabs";
import { IdeaMap } from "@/components/idea-map";

const views = [
  { value: "notes", label: "Notes" },
  { value: "journal", label: "By date" },
  { value: "graph", label: "Graph" },
] as const;

export function LibraryPreview() {
  const [view, setView] = useState("notes");
  return (
    <section
      className="library-section section-space"
      aria-labelledby="library-heading"
      id="your-library"
    >
      <div className="page-container library-layout">
        <div data-reveal>
          <p className="eyebrow">TRY THE NOTEBOOK</p>
          <h2 className="section-heading mt-4" id="library-heading">
            Your notes.
            <br />
            <em>Easy to find.</em>
          </h2>
          <p className="library-description">
            Keep plans, ideas and daily notes together. Browse by notebook, date
            or connection.
          </p>
          <ul className="library-benefits">
            <li>
              <Search size={17} aria-hidden="true" />
              <span>Search by meaning</span>
            </li>
            <li>
              <NotebookPen size={17} aria-hidden="true" />
              <span>Write a daily note</span>
            </li>
            <li>
              <Network size={17} aria-hidden="true" />
              <span>Explore related ideas</span>
            </li>
          </ul>
          <Link href="/sign-up" className="button-primary">
            Start your notebook <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="library-window" data-reveal>
          <div className="library-title">
            <span>Your Grove</span>
            <span>INTERACTIVE PREVIEW</span>
          </div>
          <Tabs
            id="library-preview"
            label="Explore your notebook"
            options={views}
            value={view}
            onChange={setView}
          />
          {views.map(({ value, label }) => (
            <div
              key={value}
              id={`library-preview-panel-${value}`}
              role="tabpanel"
              aria-labelledby={`library-preview-tab-${value}`}
              hidden={view !== value}
              tabIndex={0}
              className="library-panel"
            >
              <div className="library-panel-heading">
                <h3>{label}</h3>
                <span>
                  {value === "notes"
                    ? "Weekend projects"
                    : value === "journal"
                      ? "A page for your day"
                      : "Your ideas, connected"}
                </span>
              </div>
              {value === "notes" && (
                <>
                  <div className="library-search">
                    <Search size={14} aria-hidden="true" />
                    <span>Search your notes</span>
                  </div>
                  <article className="library-memory">
                    <span className="library-kind">For home</span>
                    <h4>A tiny balcony garden</h4>
                    <p>
                      Start with mint and rosemary. Find the corner that gets
                      the afternoon sun.
                    </p>
                    <footer>
                      <span>Weekend projects</span>
                      <span>
                        <Check size={11} aria-hidden="true" /> Saved
                      </span>
                    </footer>
                  </article>
                  <article className="library-memory">
                    <span className="library-kind">A little inspiration</span>
                    <h4>A reading corner of my own</h4>
                    <p>
                      A comfortable chair, a warm lamp, and a place for the next
                      book.
                    </p>
                    <footer>
                      <span>Weekend projects</span>
                      <span>
                        <Check size={11} aria-hidden="true" /> Saved
                      </span>
                    </footer>
                  </article>
                </>
              )}
              {value === "journal" && (
                <>
                  <p className="library-explainer">
                    A few words are enough. Keep your reflections together, in
                    the order you wrote them.
                  </p>
                  {[
                    {
                      title: "A small win",
                      text: "Went for a walk before work. I want to do that more often.",
                    },
                    {
                      title: "Something worth noticing",
                      text: "The best idea came after I closed my laptop and gave myself a little room.",
                    },
                  ].map(({ title, text }) => (
                    <article className="library-memory" key={title}>
                      <span className="library-kind">Today</span>
                      <h4>{title}</h4>
                      <p>{text}</p>
                    </article>
                  ))}
                  <p className="library-footnote">
                    Your own words. A place to return to.
                  </p>
                </>
              )}
              {value === "graph" && (
                <>
                  <p className="library-explainer">
                    Sometimes the next idea is already in your notes. See the
                    connections, then follow your curiosity.
                  </p>
                  <IdeaMap />
                  <p className="library-footnote">
                    In your notebook, tap a star to explore its linked notes.
                  </p>
                </>
              )}
            </div>
          ))}
          <p className="library-disclaimer">
            Example notes. Your notebook starts with what you save.
          </p>
        </div>
      </div>
    </section>
  );
}
