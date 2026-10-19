"use client";

import {
  Archive,
  ArrowUpRight,
  Check,
  GitBranch,
  KeyRound,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Tabs } from "@/components/tabs";

const views = [
  { value: "memories", label: "Memories" },
  { value: "connections", label: "Connections" },
  { value: "archive", label: "Archive" },
] as const;

export function LibraryPreview() {
  const [view, setView] = useState("memories");
  return (
    <section
      className="library-section section-space"
      aria-labelledby="library-heading"
      id="your-library"
    >
      <div className="page-container library-layout">
        <div data-reveal>
          <p className="eyebrow">YOUR MEMORY. IN PLAIN SIGHT.</p>
          <h2 className="section-heading mt-4" id="library-heading">
            A little less mystery.
            <br />
            <em>A lot more control.</em>
          </h2>
          <p className="library-description">
            See what your agents remember. Correct a detail. Retire an old
            decision. Your Grove gives useful context a home you can actually
            look around.
          </p>
          <ul className="library-benefits">
            <li>
              <Search size={17} aria-hidden="true" />
              <span>Search your library and browse by project</span>
            </li>
            <li>
              <GitBranch size={17} aria-hidden="true" />
              <span>Edit memories with revision history</span>
            </li>
            <li>
              <ShieldCheck size={17} aria-hidden="true" />
              <span>Approve each agent’s scope. Revoke any time.</span>
            </li>
          </ul>
          <Link href="/sign-up" className="button-primary">
            Make yourself at home <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <div className="library-window" data-reveal>
          <div className="library-title">
            <span>Your Grove</span>
            <span>INTERACTIVE PREVIEW</span>
          </div>
          <Tabs
            id="library-preview"
            label="Explore the memory library"
            options={views}
            value={view}
            onChange={setView}
          />
          {views.map(({ value, label }) => (
            <div
              key={value}
              id={`library-preview-panel-${value}`}
              role="tabpanel"
              aria-labelledby={`library-preview-tab-${value}`}
              hidden={view !== value}
              tabIndex={0}
              className="library-panel"
            >
              <div className="library-panel-heading">
                <h3>{label}</h3>
                <span>
                  {value === "memories"
                    ? "PROJECT / BILLING-API"
                    : value === "connections"
                      ? "YOU CHOOSE THE ACCESS"
                      : "KEEP THE SIGNAL"}
                </span>
              </div>
              {value === "memories" && (
                <>
                  <div className="library-search">
                    <Search size={14} aria-hidden="true" />
                    <span>Decisions, preferences, hard-won fixes…</span>
                  </div>
                  <article className="library-memory">
                    <span className="library-kind">Decision</span>
                    <h4>PostgreSQL for billing</h4>
                    <p>
                      We need reliable transactions, and the team already knows
                      it.
                    </p>
                    <footer>
                      <span>billing-api · revision 2</span>
                      <span>
                        <Check size={11} aria-hidden="true" /> Saved
                      </span>
                    </footer>
                  </article>
                  <article className="library-memory">
                    <span className="library-kind">Preference</span>
                    <h4>Tests live beside the source</h4>
                    <p>Use Vitest and name test files *.test.ts.</p>
                    <footer>
                      <span>billing-api · revision 1</span>
                      <span>
                        <Check size={11} aria-hidden="true" /> Saved
                      </span>
                    </footer>
                  </article>
                </>
              )}
              {value === "connections" && (
                <>
                  <p className="library-explainer">
                    Named connections, explicit permissions. Every agent gets
                    only the scope you approve.
                  </p>
                  {[
                    "OpenCode · Work laptop",
                    "Claude Code · Terminal",
                    "Codex · Side project",
                  ].map((name) => (
                    <article className="library-connection" key={name}>
                      <KeyRound size={18} aria-hidden="true" />
                      <div>
                        <h4>{name}</h4>
                        <p>Project-scoped connection</p>
                      </div>
                      <span>Approved</span>
                    </article>
                  ))}
                  <p className="library-footnote">
                    Manage connections and API keys in your account.
                  </p>
                </>
              )}
              {value === "archive" && (
                <>
                  <div className="library-archive">
                    <Archive size={30} strokeWidth={1.2} aria-hidden="true" />
                    <h4>Some decisions have a season.</h4>
                    <p>
                      Archive what’s no longer relevant. Restore it if you need
                      it again, or delete it permanently.
                    </p>
                  </div>
                  <article className="library-memory">
                    <span className="library-kind">Archived decision</span>
                    <h4>Use the legacy billing endpoint</h4>
                    <p>Kept out of active recall. Still yours to revisit.</p>
                  </article>
                </>
              )}
            </div>
          ))}
          <p className="library-disclaimer">
            Illustrative content · your private library starts with your
            memories
          </p>
        </div>
      </div>
    </section>
  );
}
