"use client";

import { ArrowUpRight, MessageSquare } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { GroveMark } from "@/components/brand";
import { Tabs } from "@/components/tabs";

const examples = [
  {
    value: "plans",
    label: "Travel plans",
    tag: "travel",
    notebook: "Japan trip",
    title: "Stay in Kyoto",
    saved:
      "Four nights in Kyoto. Find a small guesthouse near the Kamo River, within walking distance of a bus stop. No hotel booked yet. Leave arrival morning free for gardens and coffee. Book the pottery workshop for the second afternoon, not arrival day.",
    prompt: "Where did I want to stay in Kyoto?",
    query: "Your Kyoto plans",
    response:
      "You wanted a small guesthouse near the Kamo River for four nights, close to a bus stop. You haven’t booked it yet. Keep arrival morning free; the pottery workshop belongs on the second afternoon.",
    without:
      "No saved note about your Kyoto plans yet. Add the details you want to keep.",
  },
  {
    value: "preferences",
    label: "Everyday preferences",
    tag: "cooking",
    notebook: "About me",
    title: "Weeknight dinners",
    saved:
      "Weeknights need to be simple: vegetarian, one pan, no more than 20 minutes of prep. Make enough for lunch the next day. Chickpeas, broccoli and lemon worked well last week. Keep chilli on the side so everyone can choose their own heat.",
    prompt: "What makes a good weeknight dinner for me?",
    query: "Your dinner preferences",
    response:
      "Something vegetarian, made in one pan, with no more than 20 minutes of prep and leftovers for lunch. Chickpeas with broccoli and lemon worked last week. Keep chilli on the side.",
    without:
      "No saved note about your dinner preferences yet. Add what works for you.",
  },
  {
    value: "ideas",
    label: "Creative projects",
    tag: "gardening",
    notebook: "Weekend projects",
    title: "A tiny balcony garden",
    saved:
      "Start with mint and rosemary in the corner with afternoon sun. Give mint its own pot so it doesn’t take over. Saturday: get two pots with drainage holes, peat-free compost and a small watering can. Don’t buy more plants until these two are settled.",
    prompt: "What was my plan for the balcony?",
    query: "Your garden idea",
    response:
      "Start with mint and rosemary in the sunny corner, with mint in its own pot. Your Saturday list is two pots with drainage, peat-free compost and a watering can. Wait before adding more plants.",
    without:
      "No saved note about the balcony yet. Save your idea to find it later.",
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
      <div className="mb-10" data-reveal>
        <h2 id="demo-heading" className="section-heading mt-4">
          Find the thought you need
        </h2>
        <p className="mt-5 max-w-lg text-sm leading-7 text-muted">
          You don&apos;t need the exact words. Ask Grove and follow the answer
          back to the note you saved.
        </p>
      </div>

      <div className="demo-shell" data-ui data-reveal>
        <div className="demo-toolbar">
          <Tabs
            id="memory-example"
            label="Choose a notebook example"
            options={examples}
            value={selected}
            onChange={setSelected}
          />
        </div>
        <div className="demo-pages">
          {examples.map((example) => (
            <div
              key={example.value}
              id={`memory-example-panel-${example.value}`}
              role="tabpanel"
              aria-labelledby={`memory-example-tab-${example.value}`}
              data-inactive={selected !== example.value}
              aria-hidden={selected !== example.value}
              inert={selected !== example.value}
              tabIndex={0}
              className="demo-panel demo-transition"
            >
              <div className="demo-memory">
                <div
                  className="memory-note"
                  id={`example-note-${example.value}`}
                  tabIndex={-1}
                >
                  <h3 className="mb-3 text-base font-medium">
                    {example.title}
                  </h3>
                  <p className="font-editorial text-[23px] leading-[1.4] text-forest">
                    {example.saved}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted">
                    <span className="rounded bg-sage px-2 py-1">
                      {example.notebook}
                    </span>
                  </div>
                </div>
              </div>

              <div className="demo-conversation">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div
                    className="inline-flex rounded-md border border-line bg-paper p-1"
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
                    <p className="demo-query mt-1 text-sm leading-6">
                      {example.prompt}
                    </p>
                  </div>
                </div>
                <div
                  className="demo-answer-pages mt-4"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <div
                    className="demo-answer-state"
                    data-inactive={!withGrove}
                    aria-hidden={!withGrove}
                    inert={!withGrove}
                  >
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
                          aria-label={`View note: 1. ${example.title}`}
                        >
                          1. {example.title}
                        </a>
                      </div>
                    </div>
                  </div>
                  <div
                    className="demo-answer-state"
                    data-inactive={withGrove}
                    aria-hidden={withGrove}
                    inert={withGrove}
                  >
                    <div className="flex items-start gap-3 rounded-lg bg-paper p-4">
                      <MessageSquare
                        size={16}
                        className="mt-1 shrink-0 text-muted"
                      />
                      <div>
                        <span className="text-[11px] text-muted">
                          Ask Grove
                        </span>
                        <p className="mt-2 text-sm leading-7 text-muted">
                          {example.without}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="demo-caption">
          <p className="max-w-xl text-[13px] leading-relaxed text-muted">
            Example notes and answers. Your own answers come from the notes you
            save.
          </p>
          <Link
            href="/sign-up"
            className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-forest hover:underline"
          >
            Start your notebook <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
