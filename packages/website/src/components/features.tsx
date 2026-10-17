import {
  ArrowUpRight,
  Database,
  GitBranch,
  Layers3,
  LockKeyhole,
  Search,
  SlidersHorizontal,
  Sprout,
} from "lucide-react";
import { site } from "@/lib/site";

export function Features() {
  return (
    <section
      id="features"
      className="page-container section-space pt-4!"
      aria-labelledby="features-heading"
    >
      <div className="section-intro">
        <div>
          <p className="eyebrow">THE MEMORY TOOLKIT</p>
          <h2 id="features-heading" className="section-heading mt-4">
            Useful context.
            <br />
            <em>Ready to retrieve.</em>
          </h2>
        </div>
        <p>
          Keep the useful bits. Find the right context. Connect what matters.
          All through tools your agent can use.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        <article className="feature-card bg-white/60">
          <span className="feature-icon">
            <Search size={20} />
          </span>
          <h3>
            Find the meaning.
            <br />
            Not just the keywords.
          </h3>
          <p>
            Ask about “the billing database” and find the decision about
            PostgreSQL. Semantic search retrieves related memories, with
            optional reranking for a sharper match.
          </p>
          <div
            className="search-illustration"
            aria-label="Illustrative semantic search matching a query to a related memory"
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-xs text-muted">
              <Search size={14} />
              <span>Why did we choose this database?</span>
              <span className="ml-auto rounded border border-line px-1.5 font-mono text-[9px]">
                ↵
              </span>
            </div>
            <div className="m-3 rounded-md border border-leaf/20 bg-sage/50 px-3 py-3">
              <div className="mb-2 flex items-center justify-between text-[9px]">
                <span className="font-mono text-leaf">RELATED MEMORY</span>
                <span className="text-muted">#architecture</span>
              </div>
              <p className="text-xs! leading-6! text-forest!">
                PostgreSQL gives our billing service the reliable transactions
                it needs.
              </p>
            </div>
          </div>
        </article>

        <article className="feature-card bg-white/60">
          <span className="feature-icon">
            <GitBranch size={20} />
          </span>
          <h3>
            Good context
            <br />
            connects the dots.
          </h3>
          <p>
            Build a knowledge graph of entities, observations, and
            relationships. Give your agent a way to explore how your projects,
            services, and decisions fit together.
          </p>
          <div
            className="graph-illustration"
            aria-label="Example knowledge graph: Billing API uses PostgreSQL and is part of My app"
          >
            <svg
              viewBox="0 0 400 130"
              className="absolute inset-0 size-full"
              aria-hidden="true"
            >
              <path
                d="M80 65H320"
                fill="none"
                stroke="#9aa78c"
                strokeWidth="1.3"
              />
              <path
                d="m127 61-6 4 6 4m141-8 6 4-6 4"
                fill="none"
                stroke="#9aa78c"
                strokeWidth="1.3"
              />
            </svg>
            <div className="graph-entity">
              <Layers3 size={18} />
              <span>My app</span>
            </div>
            <span className="graph-edge">part of</span>
            <div className="graph-entity border-leaf/30! bg-forest! text-paper!">
              <GitBranch size={18} />
              <span>Billing API</span>
            </div>
            <span className="graph-edge">uses</span>
            <div className="graph-entity">
              <Database size={18} />
              <span>PostgreSQL</span>
            </div>
          </div>
        </article>

        <article className="feature-card bg-white/60">
          <span className="feature-icon">
            <LockKeyhole size={20} />
          </span>
          <h3>
            Your context.
            <br />
            Your infrastructure.
          </h3>
          <p>
            Self-host Grove and Qdrant on your own infrastructure. Local ONNX
            embeddings are the default. No hosted memory subscription standing
            between you and your work.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["Self-hosted", "Local embeddings", "MIT licensed"].map(
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

        <article className="feature-card bg-white/60">
          <span className="feature-icon">
            <Sprout size={20} />
          </span>
          <h3>
            Manage the lifecycle.
            <br />
            Keep the signal.
          </h3>
          <p>
            Organize by project, session, and tags. Set importance, update what
            changes, and prune what no longer helps. Keep your memory store
            relevant as your codebase evolves.
          </p>
          <div className="mt-8 flex items-center gap-3 rounded-lg border border-leaf/15 bg-white/50 px-4 py-3">
            <SlidersHorizontal size={16} className="shrink-0 text-leaf" />
            <span className="text-[11px] text-muted">Keep what matters</span>
            <span className="ml-auto flex gap-1" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <span
                  key={i}
                  className={`h-4 w-1.5 rounded-sm ${i < 5 ? "bg-leaf" : "bg-leaf/15"}`}
                />
              ))}
            </span>
          </div>
        </article>
      </div>
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-y border-line py-5 text-xs">
        <p className="text-muted">
          <span className="font-medium text-forest">21 MCP tools.</span> Memory,
          entities, and relationships. Ready for your agent.
        </p>
        <a
          href={site.docs}
          className="inline-flex min-h-8 items-center gap-2 font-medium text-forest hover:underline"
        >
          Explore the tool reference <ArrowUpRight size={14} />
        </a>
      </div>
    </section>
  );
}
