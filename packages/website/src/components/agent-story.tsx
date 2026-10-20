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
          <p className="eyebrow">
            FOR DEVELOPERS / CONTEXT THAT COMES WITH YOU
          </p>
          <h2 id="agents-heading" className="section-heading">
            New session.
            <br />
            <em>Same head start.</em>
          </h2>
          <p className="agent-story-copy">
            The decision you already made. The fix you finally found. Give your
            AI tools a shared place to remember the useful bits, right alongside
            the notes you keep yourself.
          </p>
          <p className="agent-story-copy">
            Connect OpenCode, Claude Code, or Codex. Choose the notebooks each
            connection can access, then review and edit what is saved. Hosted or
            self-hosted, the context stays yours to manage.
          </p>
          <div className="agent-story-actions">
            <Link href="/install" className="button-primary">
              Connect your agent <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link href="/self-host" className="nav-link">
              Self-host Grove <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <figure className="agent-terminal" data-reveal>
          <p>ONE LIBRARY. YOUR TOOLS.</p>
          <code>$ npx @miniaxolotl/grove connect</code>
          <ol>
            <li>
              <span>01</span>
              <div>
                Connect your tool
                <small>Authorize access to your Grove account.</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                Choose its context
                <small>Scope the connection to the notebooks it needs.</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                Pick up the thread
                <small>
                  Remember useful details and recall relevant notes.
                </small>
              </div>
            </li>
          </ol>
          <figcaption>
            Illustrated setup. Tools: remember, recall, memories, forget.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
