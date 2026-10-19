import {
  ArrowDown,
  ArrowRight,
  Database,
  Network,
  Terminal,
} from "lucide-react";
import { GroveMark } from "@/components/brand";

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
            <p className="eyebrow text-lime/75">SIMPLE ARCHITECTURE</p>
            <h2 id="how-heading" className="section-heading mt-4">
              Your agent calls the tools.
              <br />
              <em className="text-lime!">Grove keeps the context.</em>
            </h2>
          </div>
          <p className="text-paper/65!">
            A focused MCP server between your agent and a persistent store.
            Explicit tool calls. Local embeddings. Durable storage.
          </p>
        </div>

        <div className="architecture-strip">
          <div>
            <Terminal size={25} strokeWidth={1.4} />
            <span>Your AI agent</span>
            <small>OpenCode, Claude, or Codex</small>
          </div>
          <span className="architecture-arrow">
            <span>MCP TOOLS</span>
            <ArrowRight size={32} strokeWidth={1} className="hidden sm:block" />
            <ArrowDown size={23} strokeWidth={1} className="sm:hidden" />
          </span>
          <div className="architecture-grove">
            <GroveMark className="size-10" />
            <span>Grove</span>
            <small>Authenticated private memory</small>
          </div>
          <span className="architecture-arrow">
            <span>PERSISTENT STORAGE</span>
            <ArrowRight size={32} strokeWidth={1} className="hidden sm:block" />
            <ArrowDown size={23} strokeWidth={1} className="sm:hidden" />
          </span>
          <div>
            <Database size={25} strokeWidth={1.4} />
            <span>PostgreSQL</span>
            <small>Account-owned rows + pgvector</small>
          </div>
        </div>

        <div className="mt-14 grid gap-8 md:grid-cols-3 md:gap-10">
          {[
            {
              number: "01",
              title: "Save the useful things.",
              description:
                "Your agent calls remember to save a preference, confirmed decision, useful fact, verified solution, or short handoff. Choose personal or project scope.",
            },
            {
              number: "02",
              title: "Keep it private.",
              description:
                "Grove saves the memory transactionally in PostgreSQL and indexes its current revision. Only your account and approved connections can access it.",
            },
            {
              number: "03",
              title: "Pick up where you left off.",
              description:
                "In a later session, your agent searches by meaning and uses the relevant memories as context. Less repetition. More forward motion.",
            },
          ].map(({ number, title, description }) => (
            <div key={number} className="border-t border-paper/15 pt-5">
              <span className="font-mono text-[11px] text-lime/65">
                {number}
              </span>
              <h3 className="mt-4 text-lg font-medium tracking-tight">
                {title}
              </h3>
              <p className="mt-3 text-[13px] leading-7 text-paper/65">
                {description}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-10 flex items-center justify-center gap-2 text-center text-[11px] text-paper/70">
          <Network size={14} className="shrink-0" /> Local embeddings by
          default. One authenticated API for your website and agents.
        </p>
      </div>
    </section>
  );
}
