"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, Check, Sprout } from "lucide-react";
import { agentNames, type ConnectInput } from "@lib/shared/contracts";
import { CodeBlock } from "@/components/code-block";
import { Tabs } from "@/components/tabs";
import {
  connectCommand,
  firstMemory,
  mcpEndpoint,
  recallMemory,
} from "@/content/install";

const clientOptions = [
  { value: "opencode", label: "OpenCode" },
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "mcp", label: "Other MCP clients" },
];

export function AgentSetup({ origin }: { origin?: string }) {
  const [client, setClient] = useState("opencode");
  return (
    <div className="min-w-0">
      <Tabs
        id="agent-setup"
        label="Choose your agent"
        options={clientOptions}
        value={client}
        onChange={setClient}
      />
      {clientOptions.map(({ value, label }) => (
        <div
          key={value}
          id={`agent-setup-panel-${value}`}
          role="tabpanel"
          aria-labelledby={`agent-setup-tab-${value}`}
          hidden={client !== value}
          tabIndex={0}
          className="mt-4"
        >
          <CodeBlock
            title={
              value === "mcp"
                ? "Streamable HTTP endpoint"
                : `${label} connection command`
            }
            code={
              value === "mcp"
                ? origin
                  ? `${origin}/mcp`
                  : mcpEndpoint
                : connectCommand(value as ConnectInput["agent"], origin)
            }
          />
          <p className="mt-3 text-xs leading-6 text-muted">
            {value === "mcp"
              ? "Add this remote MCP server in your client, sign in with OAuth, then approve its access in Grove Connections. Named API keys are also available for headless clients."
              : `Run this inside your project with ${agentNames[value as ConnectInput["agent"]]} installed and Node.js 22+. Sign in and approve access in your browser; Grove links your project and configures the integration automatically.`}
          </p>
        </div>
      ))}
    </div>
  );
}

export function Installation() {
  return (
    <ol className="installation-steps">
      <li className="installation-step">
        <div className="installation-copy">
          <span className="step-number">01</span>
          <h3>Choose your agent.</h3>
          <p>
            One command connects you to Grove Cloud. Bring the agent you already
            work with.
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-leaf">
            <Check size={13} /> Browser sign-in · Project-aware setup
          </span>
        </div>
        <AgentSetup />
      </li>
      <li className="installation-step">
        <div className="installation-copy">
          <span className="step-number">02</span>
          <h3>Make yourself at home.</h3>
          <p>
            Sign in, choose what your agent can access, and return to your
            terminal.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-sage/40 p-6 text-sm leading-7">
          <h4 className="font-medium">Your choices, remembered.</h4>
          <p className="mt-3 text-muted">
            Start with reading and saving personal memories and context for this
            project. Customize access before connecting, or change it later in
            Connections.
          </p>
          <p className="mt-3 text-muted">
            Keep the terminal open while you approve. Grove finishes setup and
            tells you when to restart your agent. Interrupted? Run the same
            command to resume.
          </p>
        </div>
      </li>
      <li className="installation-step">
        <div className="installation-copy">
          <span className="step-number">
            <Sprout size={18} />
          </span>
          <h3>Plant your first memory.</h3>
          <p>
            Ask your agent to save something worth keeping. Open a new session,
            recall it, and pick up the thread.
          </p>
        </div>
        <div className="min-w-0 space-y-3">
          <CodeBlock
            title="Ask your agent to remember"
            code={firstMemory}
            light
          />
          <p className="flex items-center gap-2 pl-4 text-[11px] text-leaf">
            <ArrowDown size={13} /> Then, in a new session
          </p>
          <CodeBlock
            title="Ask your agent to recall"
            code={recallMemory}
            light
          />
          <p className="pt-2 text-xs leading-6 text-muted">
            Running your own infrastructure?{" "}
            <Link
              href="/self-host"
              className="text-leaf underline underline-offset-4"
            >
              Install Grove Open Source
            </Link>
            .
          </p>
        </div>
      </li>
    </ol>
  );
}
