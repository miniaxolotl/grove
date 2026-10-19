"use client";

import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  Sprout,
} from "lucide-react";
import { useState } from "react";
import { CodeBlock } from "@/components/code-block";
import { Tabs } from "@/components/tabs";
import {
  dockerSetup,
  firstMemory,
  mcpEndpoint,
  npmSetup,
  opencodeConfig,
  recallMemory,
} from "@/content/install";

const serverOptions = [
  { value: "docker", label: "Docker Compose", badge: "Recommended" },
  { value: "npm", label: "npm" },
];
const clientOptions = [
  { value: "opencode", label: "OpenCode" },
  { value: "mcp", label: "Other MCP clients" },
];

export function Installation() {
  const [server, setServer] = useState("docker");
  const [client, setClient] = useState("opencode");

  return (
    <ol className="installation-steps">
      <li className="installation-step">
        <div className="installation-copy">
          <span className="step-number">01</span>
          <h3>Give your memories a home.</h3>
          <p>
            Sign in to your Grove deployment and install the client with npm.
            Self-hosting? Compose starts the API, worker, and private
            PostgreSQL.
          </p>
          <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-leaf">
            <Check size={13} /> macOS, Linux, or Windows with Docker
          </span>
        </div>
        <div className="min-w-0">
          <Tabs
            id="server-setup"
            label="Installation method"
            options={serverOptions}
            value={server}
            onChange={setServer}
          />
          {serverOptions.map(({ value }) => (
            <div
              key={value}
              id={`server-setup-panel-${value}`}
              role="tabpanel"
              aria-labelledby={`server-setup-tab-${value}`}
              hidden={server !== value}
              tabIndex={0}
              className="mt-4"
            >
              <CodeBlock
                title={value === "docker" ? "Docker setup" : "npm setup"}
                code={value === "docker" ? dockerSetup : npmSetup}
              />
              <p className="mt-3 text-xs leading-6 text-muted">
                {value === "docker"
                  ? "Requires Git, Docker Compose, and a configured Grove Clerk application. Set the keys and generated passwords before starting. The first run downloads the local embedding model."
                  : "Requires Node.js 22+. Replace the example origin with your Grove API. Use --client claude or --client codex for those agents. Approve the connection in your dashboard."}
              </p>
            </div>
          ))}
          <details className="mt-3 text-xs text-muted">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 font-medium text-leaf">
              Check that Grove is ready <ChevronDown size={13} />
            </summary>
            <div className="mt-2">
              <CodeBlock
                title="Readiness check"
                code="curl --fail http://localhost:26080/health/ready"
              />
              <p className="mt-2 leading-6">
                Wait for initialization to finish. The readiness endpoint
                returns HTTP 200 after the database and configured embedding
                model are ready.
              </p>
            </div>
          </details>
        </div>
      </li>

      <li className="installation-step">
        <div className="installation-copy">
          <span className="step-number">02</span>
          <h3>Make the connection.</h3>
          <p>
            Give your agent access to Grove’s MCP tools. Use the OpenCode
            configuration, or connect your preferred MCP client.
          </p>
          <a
            className="mt-4 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-leaf hover:underline"
            href="https://github.com/miniaxolotl/grove/blob/HEAD/documentation/server.md"
          >
            Client configuration reference <ArrowUpRight size={13} />
          </a>
        </div>
        <div className="min-w-0">
          <Tabs
            id="agent-setup"
            label="MCP client"
            options={clientOptions}
            value={client}
            onChange={setClient}
          />
          <div
            id="agent-setup-panel-opencode"
            role="tabpanel"
            aria-labelledby="agent-setup-tab-opencode"
            hidden={client !== "opencode"}
            tabIndex={0}
            className="mt-4"
          >
            <CodeBlock title="opencode.json" code={opencodeConfig} />
            <p className="mt-3 text-xs leading-6 text-muted">
              Grove init merges this entry into OpenCode V2 configuration. The
              plugin adds four memory tools and bounded context recall. Run
              grove project after approving project access to resolve the same
              repository identity across agents and worktrees.
            </p>
          </div>
          <div
            id="agent-setup-panel-mcp"
            role="tabpanel"
            aria-labelledby="agent-setup-tab-mcp"
            hidden={client !== "mcp"}
            tabIndex={0}
            className="mt-4"
          >
            <CodeBlock title="Streamable HTTP endpoint" code={mcpEndpoint} />
            <p className="mt-3 text-xs leading-6 text-muted">
              Add a remote MCP server named{" "}
              <code className="inline-code">grove</code> with this URL and the
              Streamable HTTP transport. Configuration fields vary by client.
              Use your deployment’s API origin. Sign in with OAuth or provide a
              named, scoped API key.
            </p>
            <p className="mt-3 text-xs leading-6 text-muted">
              Prefer stdio? Install the npm package and configure your client to
              launch <code className="inline-code">grove mcp --stdio</code>
              after running grove login. The bridge and hooks share the same
              Grove-managed connection.
            </p>
          </div>
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
            search for it, and pick up the thread.
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
            Grove makes memory available through tools. Ask your agent to use
            them, or add saving and recall instructions to your agent’s
            workflow.
          </p>
        </div>
      </li>
    </ol>
  );
}
