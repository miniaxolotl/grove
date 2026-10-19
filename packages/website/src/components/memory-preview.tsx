import { ArrowDown, Check, GitBranch, LockKeyhole } from "lucide-react";
import { GroveMark } from "@/components/brand";

export function MemoryPreview() {
  return (
    <figure
      className="memory-garden"
      aria-label="OpenCode, Claude Code, and Codex connect to one private Grove memory library"
    >
      <div className="garden-grid" aria-hidden="true" />
      <div className="memory-garden-heading">
        <span>YOUR CONTEXT, CONNECTED</span>
        <LockKeyhole size={13} aria-hidden="true" />
      </div>
      <div className="agent-canopy">
        <span>
          <b aria-hidden="true">&gt;_</b>OpenCode
        </span>
        <span>
          <b aria-hidden="true">✳</b>Claude Code
        </span>
        <span>
          <b aria-hidden="true">⌘</b>Codex
        </span>
      </div>
      <div className="memory-roots" aria-hidden="true">
        <svg viewBox="0 0 480 110" preserveAspectRatio="none">
          <path d="M80 0V24Q80 46 102 46H216Q240 46 240 72V110M240 0V110M400 0V24Q400 46 378 46H264Q240 46 240 72" />
          <path
            className="context-flow"
            d="M80 0V24Q80 46 102 46H216Q240 46 240 72V110M240 0V110M400 0V24Q400 46 378 46H264Q240 46 240 72"
          />
        </svg>
        <span className="memory-root-mark">
          <GroveMark className="size-10" />
        </span>
      </div>
      <div className="context-window">
        <div className="context-title">
          <span>
            <GroveMark className="size-5" /> Your memory, with you.
          </span>
          <span className="context-example">EXAMPLE</span>
        </div>
        <div className="context-body">
          <div className="context-tags">
            <span>
              <GitBranch size={11} aria-hidden="true" /> billing-api
            </span>
            <span>Decision</span>
          </div>
          <p className="context-quote">
            “Use PostgreSQL for billing.
            <br />
            We need reliable transactions.”
          </p>
          <div className="context-saved">
            <Check size={13} aria-hidden="true" /> Remembered in OpenCode
          </div>
        </div>
        <div className="context-recall">
          <ArrowDown size={15} aria-hidden="true" />
          <span>
            New session in Claude Code?
            <strong>The reasoning comes with you.</strong>
          </span>
          <code>recall</code>
        </div>
      </div>
      <figcaption>
        One account. Shared context. A fresh start that isn’t from scratch.
      </figcaption>
    </figure>
  );
}
