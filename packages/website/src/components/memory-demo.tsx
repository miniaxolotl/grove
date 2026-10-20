"use client";

import {
  ArrowDown,
  ArrowUpRight,
  Check,
  MessageSquare,
  Search,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { GroveMark } from "@/components/brand";
import { Tabs } from "@/components/tabs";

const examples = [
  {
    value: "plans",
    label: "Travel plans",
    tag: "a little adventure",
    notebook: "Japan trip",
    title: "Stay in Kyoto",
    saved:
      "Stay in Kyoto for four nights. A small guesthouse near the river, with time for gardens and neighborhood cafés.",
    prompt: "Where did I want to stay in Kyoto?",
    query: "Your Kyoto plans",
    response:
      "You’re looking for a small guesthouse near the river, for four nights. You wanted time to explore gardens and neighborhood cafés.",
    without:
      "There isn’t a saved note about your Kyoto plans yet. Add the details you’d like to come back to.",
  },
  {
    value: "preferences",
    label: "Everyday preferences",
    tag: "the little things",
    notebook: "About me",
    title: "Weeknight dinners",
    saved:
      "I prefer simple vegetarian dinners: one pan, little prep, and plenty of leftovers.",
    prompt: "What makes a good weeknight dinner for me?",
    query: "Your dinner preferences",
    response:
      "Something vegetarian, made in one pan, with minimal prep and enough leftovers for another day.",
    without:
      "There isn’t a saved note about your dinner preferences yet. Add what works for you, so it’s easy to find next time.",
  },
  {
    value: "ideas",
    label: "Creative projects",
    tag: "a fresh start",
    notebook: "Weekend projects",
    title: "A tiny balcony garden",
    saved:
      "Start a small balcony garden with mint and rosemary. Use the corner with afternoon sun. Keep the first weekend simple: two pots and good soil.",
    prompt: "What was my plan for the balcony?",
    query: "Your garden idea",
    response:
      "Start with mint and rosemary in the sunny corner. For the first weekend, you planned to get two pots and good soil.",
    without:
      "There isn’t a saved note about the balcony yet. Capture your idea now, and you can pick it up later.",
  },
];

export function MemoryDemo() {
  const [selected, setSelected] = useState("plans");
  const [withGrove, setWithGrove] = useState(true);

  return (
    <section
      id="memory-in-action"
      className="page-container section-space"
      aria-labelledby="demo-heading"
    >
      <div className="mb-10 text-center">
        <p className="eyebrow">MEET ASK GROVE</p>
        <h2 id="demo-heading" className="section-heading mt-4">
          You had a thought.
          <br />
          <em>Here it is again.</em>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-muted">
          Ask a question in your own words. Grove finds the details you saved
          and links its answer back to your notes.
        </p>
      </div>

      <div className="demo-shell">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <Tabs
            id="memory-example"
            label="Choose a notebook example"
            options={examples}
            value={selected}
            onChange={setSelected}
          />
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <Sparkles size={12} /> Interactive example
          </span>
        </div>
        {examples.map((example) => (
          <div
            key={example.value}
            id={`memory-example-panel-${example.value}`}
            role="tabpanel"
            aria-labelledby={`memory-example-tab-${example.value}`}
            hidden={selected !== example.value}
            tabIndex={0}
            className="demo-panel"
          >
            <div className="demo-memory">
              <span className="eyebrow text-leaf">A NOTE YOU SAVED</span>
              <div
                className="memory-note"
                id={`example-note-${example.value}`}
                tabIndex={-1}
              >
                <div className="mb-5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-leaf">
                    <Check size={13} /> Saved to Grove
                  </span>
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full bg-[#d3cbb3] shadow-inner"
                  />
                </div>
                <h3 className="mb-3 text-base font-medium">{example.title}</h3>
                <p className="font-editorial text-[23px] leading-[1.4] text-forest">
                  “{example.saved}”
                </p>
                <div className="mt-6 flex flex-wrap gap-2 text-[10px] text-muted">
                  <span className="rounded bg-sage px-2 py-1">
                    {example.notebook}
                  </span>
                  <span className="rounded border border-line px-2 py-1">
                    {example.tag}
                  </span>
                </div>
              </div>
              <p className="mt-5 flex items-center gap-2 text-xs text-muted">
                <ArrowDown size={13} className="text-leaf" /> A little detail,
                ready when you need it.
              </p>
            </div>

            <div className="min-w-0 px-5 py-7 sm:p-8 lg:p-10">
              <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
                <span className="eyebrow text-leaf">
                  WHEN YOU COME BACK TO IT
                </span>
                <div
                  className="inline-flex rounded-full border border-line bg-paper p-1"
                  aria-label="Compare answers with and without a saved note"
                >
                  <button
                    type="button"
                    aria-pressed={!withGrove}
                    onClick={() => setWithGrove(false)}
                    className={`comparison-button ${!withGrove ? "comparison-active" : ""}`}
                  >
                    No saved note
                  </button>
                  <button
                    type="button"
                    aria-pressed={withGrove}
                    onClick={() => setWithGrove(true)}
                    className={`comparison-button ${withGrove ? "comparison-active" : ""}`}
                  >
                    With a note
                  </button>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-line">
                  <MessageSquare size={13} />
                </span>
                <div>
                  <span className="text-[11px] text-muted">You</span>
                  <p className="mt-1 text-sm leading-6">{example.prompt}</p>
                </div>
              </div>
              <div
                className="mt-6 min-h-[190px]"
                aria-live="polite"
                aria-atomic="true"
              >
                {withGrove ? (
                  <>
                    <div className="mb-5 ml-10 flex items-start gap-2 rounded-md border border-line bg-sage/40 px-3 py-2.5 text-[11px] leading-5 text-leaf">
                      <Search size={12} className="mt-1 shrink-0" />
                      <span>
                        Found in{" "}
                        <span className="text-muted">“{example.query}”</span>
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-forest text-lime">
                        <GroveMark className="size-5" />
                      </span>
                      <div>
                        <span className="text-[11px] font-medium text-leaf">
                          Ask Grove
                        </span>
                        <p className="mt-1 text-sm leading-7">
                          {example.response}
                        </p>
                        <a
                          href={`#example-note-${example.value}`}
                          className="demo-source"
                          aria-label={`View note: ${example.title}`}
                        >
                          1 · {example.title}
                        </a>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-start gap-3 rounded-lg bg-paper p-4">
                    <MessageSquare
                      size={16}
                      className="mt-1 shrink-0 text-muted"
                    />
                    <div>
                      <span className="text-[11px] text-muted">Ask Grove</span>
                      <p className="mt-2 text-sm leading-7 text-muted">
                        {example.without}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-7">
          <p className="max-w-xl text-[10px] leading-relaxed text-muted">
            Example notes and answers. Your own answers come from the notes you
            save.
          </p>
          <a
            href="#install"
            className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-forest hover:underline"
          >
            Make space for your ideas <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </section>
  );
}
