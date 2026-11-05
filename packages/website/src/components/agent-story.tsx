import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export function AgentStory() {
  return (
    <section
      id="for-developers"
      className="page-container agent-story"
      aria-labelledby="agents-heading"
    >
      <div className="agent-story-grid">
        <div data-reveal>
          <h2 id="agents-heading" className="section-heading">
            Connect your AI tools
          </h2>
          <p className="agent-story-copy">
            Give OpenCode, Claude Code or Codex the project notes it needs.
            Choose its notebooks and review what it saves.
          </p>
          <div className="agent-story-actions">
            <Link href="/install" className="button-primary">
              Connect your AI tools <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/self-host" className="nav-link">
              Self-host Grove <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <figure className="agent-terminal" data-ui data-reveal>
          <p>Connect your agent</p>
          <code>$ npx @miniaxolotl/grove connect</code>
          <ol>
            <li>
              <div>
                Connect your tool
                <small>Authorize access to your Grove account.</small>
              </div>
            </li>
            <li>
              <div>
                Choose its notebooks
                <small>Give it access to the notes it needs.</small>
              </div>
            </li>
            <li>
              <div>
                Save and recall notes
                <small>Use saved notes across sessions.</small>
              </div>
            </li>
          </ol>
          <figcaption>
            Illustrated setup. Browse the documentation for the current tools
            and access controls.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
