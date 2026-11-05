"use client";

import Link from "next/link";
import { useId } from "react";
import { ArrowDown } from "lucide-react";
import type { ConnectInput } from "@lib/shared/contracts";
import { CodeBlock } from "@/components/code-block";
import { Tabs } from "@/components/tabs";
import { useSelectedAgent } from "@/lib/selected-agent";
import { HostedChatSetup } from "./hosted-chat-setup";
import {
  clientOptions,
  connectCommand,
  firstMemory,
  firstPersonalMemory,
  isHostedClient,
  mcpEndpoint,
  recallMemory,
  recallPersonalMemory,
} from "@/content/install";

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
          {isHostedClient(value) ? (
            <HostedChatSetup
              client={value}
              origin={origin}
              id={`${id}-${value}`}
            />
          ) : (
            <>
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
                  : `Run this inside your project with ${label} installed and Node.js 22+. The command opens browser sign-in and installs the integration after approval. Loading it in your agent is a separate step below.`}
              </p>
            </>
          )}
        </div>
      ))}
      {headless && !isHostedClient(client) && (
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
  const [client] = useSelectedAgent();
  const hosted = isHostedClient(client);
  return (
    <ol className="installation-steps">
      <li className="installation-step">
        <div className="installation-copy">
          <h3>Choose your agent.</h3>
          <p>Use Grove in a web chat or connect your coding agent.</p>
        </div>
        <AgentSetup />
      </li>
      <li className="installation-step">
        <div className="installation-copy">
          <h3>Sign in and approve access.</h3>
          <p>
            Create an account or sign in with your preferred provider. Approve
            access and return to {hosted ? "your chat" : "your terminal"}.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-sage/40 p-6 text-sm leading-7">
          <h4 className="font-medium">Review connection access.</h4>
          <p className="mt-3 text-muted">
            New connections start with all permission and scope checkboxes
            selected, including deletion and all current and future notebooks.
            Uncheck any access you do not want before approving. Existing
            connections keep their saved choices.
          </p>
          <p className="mt-3 text-muted">
            {hosted
              ? "In Settings → Connections, approve the exact pending client you just added. Signing in alone does not approve its access."
              : "Keep the terminal open while you approve. Interrupted? Run the same command to resume; do not delete credentials to start over."}
          </p>
        </div>
      </li>
      <li className="installation-step">
        <div className="installation-copy">
          <h3>
            {hosted ? "Return to your chat." : "Load Grove in your tool."}
          </h3>
          <p>
            Account access and a running host connection are separate checks.
          </p>
        </div>
        <div className="setup-checkpoint">
          <p>
            {hosted
              ? "Return to the chat where you added Grove and check that its tools are available. A completed Grove approval alone does not prove the chat has loaded the connection."
              : client === "opencode"
                ? "OpenCode reloads watched configuration automatically. Check its MCP tools for Grove; use /reload if it has not appeared."
                : client === "claude"
                  ? "In Claude Code, run /reload-plugins or start a new session. Check that the Grove plugin and its MCP tools are available."
                  : client === "codex"
                    ? "Restart Codex after setup. Check that Grove's MCP tools are loaded, and review or trust optional hooks in the host before relying on automatic recall."
                    : "Refresh your MCP client's server connection and tool catalog. Use its connection status to check that Grove is available."}
          </p>
          <Link href="/docs/client#diagnose-installation-and-startup">
            Troubleshoot the connection
          </Link>
        </div>
      </li>
      <li className="installation-step">
        <div className="installation-copy">
          <h3>Save your first note.</h3>
          <p>
            Ask your agent to save a note. Open a new session and ask it to
            recall that note.
          </p>
        </div>
        <div className="min-w-0 space-y-3">
          <CodeBlock
            title="Ask your agent to remember"
            code={hosted ? firstPersonalMemory : firstMemory}
            light
          />
          <p className="flex items-center gap-2 pl-4 text-[11px] text-leaf">
            <ArrowDown size={13} /> Then, in a new session
          </p>
          <CodeBlock
            title="Ask your agent to recall"
            code={hosted ? recallPersonalMemory : recallMemory}
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
