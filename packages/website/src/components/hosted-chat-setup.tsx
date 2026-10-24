"use client";

import Link from "next/link";
import { CopyButton } from "./copy-button";
import { hostedClients, mcpEndpoint } from "@/content/install";

export function HostedChatSetup({
  client,
  origin,
  id,
}: {
  client: keyof typeof hostedClients;
  origin?: string;
  id: string;
}) {
  const host = hostedClients[client];
  return (
    <div className="hosted-chat-setup space-y-4 text-sm leading-7">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-url`} className="text-xs font-medium">
            MCP server URL
          </label>
          <CopyButton
            text={origin ? `${origin}/mcp` : mcpEndpoint}
            label="Copy MCP server URL"
          />
        </div>
        <input
          id={`${id}-url`}
          type="text"
          readOnly
          value={origin ? `${origin}/mcp` : mcpEndpoint}
          className="w-full rounded-lg border border-line bg-white/60 px-3 py-3 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-muted">
        <li>
          <a
            href={host.url}
            target="_blank"
            rel="noreferrer"
            className="text-leaf underline underline-offset-4"
            aria-label={`Open ${host.name} (opens a new tab)`}
          >
            Open {host.name}
          </a>
          {client === "chatgpt"
            ? ", choose Add → Add custom MCP server, and name it Grove."
            : ", choose Add connector → Add custom connector (Web), and name it Grove."}{" "}
          Paste the URL above.
        </li>
        <li>
          {client === "chatgpt"
            ? "Choose OAuth. Under Advanced OAuth settings, select Dynamic Client Registration (DCR) to register automatically. Review the warning, create the plugin, and sign in to Grove."
            : "Choose Sign in now and Register automatically. Add the connector, then sign in to Grove."}{" "}
          No terminal or API key is needed.
        </li>
        <li>
          Open{" "}
          <Link
            href="/app/settings/connections"
            className="text-leaf underline underline-offset-4"
          >
            Grove Connections
          </Link>{" "}
          in the same account. Refresh the list and approve the matching pending
          OAuth client. Use its client ID and creation time, not just its name.
        </li>
        <li>
          Return to {host.name}, refresh or retry the connection, and enable
          Grove in a new chat.
        </li>
      </ol>
      <p className="text-xs leading-6 text-muted">
        Custom connections depend on your chat plan and workspace policy.
        Sign-in does not grant note access. Start with Personal; add only the
        notebooks you need. Your host decides when to call Grove tools—this does
        not capture every chat automatically.
      </p>
    </div>
  );
}
