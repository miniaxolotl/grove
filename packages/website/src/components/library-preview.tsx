"use client";

import { Check, Search } from "lucide-react";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Tabs } from "@/components/tabs";

const SampleNotebookGraph = dynamic(() => import("./sample-notebook-graph"), {
  loading: () => (
    <div className="sample-graph-loading" role="status">
      Opening the sample graph…
    </div>
  ),
});

const views = [
  { value: "notes", label: "Notes" },
  { value: "journal", label: "By date" },
  { value: "graph", label: "Graph" },
] as const;

export function LibraryPreview() {
  const [view, setView] = useState("graph");
  return (
    <section
      className="library-section section-space"
      aria-labelledby="library-heading"
      id="your-library"
    >
      <div className="page-container library-layout">
        <div className="section-intro" data-reveal>
          <div>
            <h2 className="section-heading mt-4" id="library-heading">
              Your notebook
            </h2>
          </div>
          <p className="library-description">
            Organise notes, plans and checklists in nested notebooks. Search by
            meaning or filter by keyword. Switch to your journal or explore
            related ideas in the graph.
          </p>
        </div>
        <div className="library-window" data-ui data-reveal>
          <div className="sample-workspace-heading">
            <strong>Notes</strong>
            <span>Your notes, organized and connected.</span>
          </div>
          <Tabs
            id="library-preview"
            label="Explore your notebook"
            options={views}
            value={view}
            onChange={setView}
          />
          <div className="library-pages">
            {views.map(({ value }) => (
              <div
                key={value}
                id={`library-preview-panel-${value}`}
                role="tabpanel"
                aria-labelledby={`library-preview-tab-${value}`}
                data-inactive={view !== value}
                aria-hidden={view !== value}
                inert={view !== value}
                tabIndex={0}
                className="library-panel demo-transition"
              >
                {value === "notes" && (
                  <>
                    <div className="library-search">
                      <Search size={14} aria-hidden="true" />
                      <span>Search your notes</span>
                    </div>
                    <article className="library-memory">
                      <span className="library-kind">For home</span>
                      <h3>A tiny balcony garden</h3>
                      <p>
                        Mint in its own pot, rosemary in the sunny corner.
                        Saturday’s list: two pots with drainage, peat-free
                        compost and a small watering can. Start with two plants,
                        not ten.
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
                      <h3>A reading corner of my own</h3>
                      <p>
                        Move the armchair beside the west window. Use the lamp
                        from the bedroom before buying anything. Keep the books
                        I’m actually reading within reach.
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
                        text: "Left my phone at home and walked to the bakery before opening email. Solved the opening of the essay on the way back. Try the same walk tomorrow.",
                      },
                      {
                        title: "Something worth noticing",
                        text: "Maya asked about the garden over dinner. I’d forgotten I wrote the whole plan down last month. Two pots is still a good place to start. A saved idea doesn’t need to become a big project.",
                      },
                    ].map(({ title, text }) => (
                      <article className="library-memory" key={title}>
                        <span className="library-kind">Today</span>
                        <h3>{title}</h3>
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
                      Follow related notes. Ask for notebook summaries, filing
                      suggestions or action lists, and review changes before
                      applying them.
                    </p>
                    <SampleNotebookGraph />
                    <p className="library-footnote">
                      Select a note to read it and inspect its connected ideas.
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="library-disclaimer">
            Example notes. Your notebook starts with what you save.
          </p>
        </div>
      </div>
    </section>
  );
}
