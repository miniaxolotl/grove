import { ArrowRight, Check, Database, Terminal } from "lucide-react";

export function MemoryPreview() {
  return (
    <figure
      className="product-preview"
      aria-label="Example of an agent saving and recalling a project decision through Grove"
    >
      <div className="mb-5 flex items-center justify-between gap-3 text-xs text-muted">
        <span className="flex items-center gap-2">
          <Terminal size={14} aria-hidden="true" /> Your agent
        </span>
        <ArrowRight size={14} aria-hidden="true" />
        <span className="flex items-center gap-2">
          <Database size={14} aria-hidden="true" /> Persistent context
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-forest bg-forest text-paper">
        <div className="terminal-titlebar">
          <span className="flex gap-1.5" aria-hidden="true">
            <i className="size-2 rounded-full bg-[#c18b7b]" />
            <i className="size-2 rounded-full bg-[#c3b777]" />
            <i className="size-2 rounded-full bg-[#82a682]" />
          </span>
          <span>grove / MCP</span>
          <span className="text-[9px] tracking-wider">EXAMPLE</span>
        </div>
        <div className="memory-trace">
          <div>
            <p className="mb-2 text-[9px] tracking-widest text-paper/65">
              SESSION 01 · SAVE A DECISION
            </p>
            <p className="text-lime">remember</p>
            <code>
              {
                '{ "information": "Use Postgres for billing: we need ACID transactions.",\n  "metadata": { "project": "billing-api" } }'
              }
            </code>
            <p className="mt-2 flex items-center gap-2 text-lime">
              <Check size={12} aria-hidden="true" /> Saved privately
            </p>
          </div>
          <div className="border-t border-white/15 pt-5">
            <p className="mb-2 text-[9px] tracking-widest text-paper/65">
              SESSION 02 · RECALL THE CONTEXT
            </p>
            <p className="text-lime">memory_search</p>
            <code>
              {'{ "query": "Why this database?",\n  "project": "billing-api" }'}
            </code>
          </div>
          <div className="rounded-md border border-lime/20 bg-lime/10 p-3">
            <p className="text-[9px] tracking-wider text-lime">
              RELATED MEMORY
            </p>
            <p className="mt-1 font-sans text-[13px] leading-6">
              Use Postgres for billing: we need ACID transactions.
            </p>
          </div>
        </div>
      </div>
      <figcaption className="preview-caption">
        Illustrative tool calls · your agent decides what to save and recall
      </figcaption>
    </figure>
  );
}
