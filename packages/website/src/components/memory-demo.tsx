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
    value: "decisions",
    label: "Your decisions",
    tag: "architecture",
    saved:
      "Use PostgreSQL for billing. We need reliable transactions, and the team already knows it.",
    prompt: "Let’s build the billing service. Which database are we using?",
    query: "billing database",
    response:
      "PostgreSQL. You chose it for reliable transactions and the team’s familiarity. Let’s build on that decision.",
    without:
      "Do you have a preferred database? We could explore PostgreSQL, MySQL, or MongoDB…",
  },
  {
    value: "preferences",
    label: "Your preferences",
    tag: "conventions",
    saved:
      "Keep tests beside the source files. Use Vitest and name test files *.test.ts.",
    prompt: "Can you add tests for this new utility?",
    query: "test conventions",
    response:
      "I’ll use Vitest and place a .test.ts file beside the utility, following your project’s testing convention.",
    without:
      "Which testing framework would you like? And where should I put the tests?",
  },
  {
    value: "fixes",
    label: "Your hard-won fixes",
    tag: "debugging",
    saved:
      "The auth callback failed behind the proxy. Forwarding the original host header fixed the redirect URL.",
    prompt:
      "The auth redirect broke after the proxy change. Have we seen this?",
    query: "auth proxy redirect fix",
    response:
      "Yes. Last time the proxy dropped the original host header. Forwarding it fixed the callback URL. Let’s check that first.",
    without:
      "Let’s start from the beginning. Can you describe your authentication setup?",
  },
];

export function MemoryDemo() {
  const [selected, setSelected] = useState("decisions");
  const [withGrove, setWithGrove] = useState(true);

  return (
    <section
      id="memory-in-action"
      className="page-container section-space"
      aria-labelledby="demo-heading"
    >
      <div className="mb-10 text-center">
        <p className="eyebrow">SOUND FAMILIAR?</p>
        <h2 id="demo-heading" className="section-heading mt-4">
          You already explained this.
          <br />
          <em>Let’s keep it that way.</em>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-7 text-muted">
          The architecture decision. The coding convention. The bug that took
          all afternoon. Give your agent something to come back to.
        </p>
      </div>

      <div className="demo-shell">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <Tabs
            id="memory-example"
            label="Choose a memory example"
            options={examples}
            value={selected}
            onChange={setSelected}
          />
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
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
              <span className="eyebrow text-leaf">01 / A PREVIOUS SESSION</span>
              <div className="memory-note">
                <div className="mb-5 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-leaf">
                    <Check size={13} /> Saved to Grove
                  </span>
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full bg-[#d3cbb3] shadow-inner"
                  />
                </div>
                <p className="font-editorial text-[25px] leading-[1.3] text-forest">
                  “{example.saved}”
                </p>
                <div className="mt-7 flex flex-wrap gap-2 font-mono text-[9px] text-muted">
                  <span className="rounded bg-sage px-2 py-1">
                    project: my-app
                  </span>
                  <span className="rounded border border-line px-2 py-1">
                    #{example.tag}
                  </span>
                </div>
              </div>
              <p className="mt-5 flex items-center gap-2 text-xs text-muted">
                <ArrowDown size={13} className="text-leaf" /> The chat ends. The
                memory stays.
              </p>
            </div>

            <div className="min-w-0 px-5 py-7 sm:p-8 lg:p-10">
              <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
                <span className="eyebrow text-leaf">02 / A FRESH START</span>
                <div
                  className="inline-flex rounded-full border border-line bg-paper p-1"
                  aria-label="Compare agent responses"
                >
                  <button
                    type="button"
                    aria-pressed={!withGrove}
                    onClick={() => setWithGrove(false)}
                    className={`comparison-button ${!withGrove ? "comparison-active" : ""}`}
                  >
                    Without
                  </button>
                  <button
                    type="button"
                    aria-pressed={withGrove}
                    onClick={() => setWithGrove(true)}
                    className={`comparison-button ${withGrove ? "comparison-active" : ""}`}
                  >
                    With Grove
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
                    <div className="mb-5 ml-10 flex items-start gap-2 rounded-md border border-line bg-sage/40 px-3 py-2.5 font-mono text-[10px] leading-5 text-leaf">
                      <Search size={12} className="mt-1 shrink-0" />
                      <span>
                        recall{" "}
                        <span className="text-muted">“{example.query}”</span>
                      </span>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-forest text-lime">
                        <GroveMark className="size-5" />
                      </span>
                      <div>
                        <span className="text-[11px] font-medium text-leaf">
                          Your agent, with context
                        </span>
                        <p className="mt-1 text-sm leading-7">
                          {example.response}
                        </p>
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
                      <span className="text-[11px] text-muted">
                        Your agent, starting over
                      </span>
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
            Illustrative workflow, not a live agent. Your agent uses Grove’s
            tools to save and retrieve context.
          </p>
          <a
            href="#install"
            className="inline-flex min-h-9 items-center gap-2 text-xs font-medium text-forest hover:underline"
          >
            Make it your workflow <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </section>
  );
}
