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
          <p className="eyebrow">FOR DEVELOPERS</p>
          <h2 id="agents-heading" className="section-heading">
            New session.
            <br />
            <em>Same context.</em>
          </h2>
          <p className="agent-story-copy">
            Save project decisions and notes so your coding agent can use them
            in later sessions.
          </p>
          <p className="agent-story-copy">
            Connect OpenCode, Claude Code or Codex. Choose which notebooks it
            can access. Review and edit what it saves.
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
          <p>CONNECT YOUR AGENT</p>
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
                Choose its notebooks
                <small>Give it access to the notes it needs.</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                Save and recall notes
                <small>Use saved notes across sessions.</small>
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
