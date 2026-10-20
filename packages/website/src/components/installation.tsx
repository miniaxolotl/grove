"use client";

import Link from "next/link";
import { useId } from "react";
import { ArrowDown, Check, Sprout } from "lucide-react";
import { agentNames, type ConnectInput } from "@lib/shared/contracts";
import { CodeBlock } from "@/components/code-block";
import { Tabs } from "@/components/tabs";
import { useSelectedAgent } from "@/lib/selected-agent";
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

export function AgentSetup({
  origin,
  headless = false,
}: {
  origin?: string;
  headless?: boolean;
}) {
  const [client, setClient] = useSelectedAgent();
  const id = useId();
  return (
    <div className="min-w-0">
      <Tabs
        id={id}
        label="Choose your agent"
        options={clientOptions}
        value={client}
        onChange={setClient}
      />
      {clientOptions.map(({ value, label }) => (
        <div
          key={value}
          id={`${id}-panel-${value}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${value}`}
          hidden={client !== value}
          tabIndex={0}
          className="mt-4"
        >
          <CodeBlock
            installation
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
              : `Run this inside your project with ${agentNames[value as ConnectInput["agent"]]} installed and Node.js 24+. The command downloads Grove, opens account creation or sign-in, and finishes setup automatically after you approve access.`}
          </p>
        </div>
      ))}
      {headless && (
        <details className="mt-4 text-xs leading-6 text-muted">
          <summary className="cursor-pointer">
            Use an API key for a headless client
          </summary>
          <p className="my-3">
            Create a scoped key, then pass it through standard input. For a
            supported agent, run its connect command afterward to configure the
            integration with that key.
          </p>
          <CodeBlock
            title="Headless login"
            code={`npx @miniaxolotl/grove login --client ${client === "mcp" ? "cli" : client} --url ${origin || "https://api.usegrove.cloud"} --key-stdin`}
          />
        </details>
      )}
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
            Create an account or sign in with your preferred provider. Approve
            access and return to your terminal.
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
            tells you how to load its tools. Interrupted? Run the same command
            to resume.
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
              data-analytics-event="docs_link_clicked"
              data-analytics-placement="install"
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
