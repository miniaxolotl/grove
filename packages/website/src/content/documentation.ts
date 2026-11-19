// Explicitly published reference documents, never an index of the whole repository.
export const documentation = [
  {
    slug: "notebook",
    source: "workspace.md",
    title: "Your Grove notebook",
    sections: [
      ["Save your first note", "your-first-saved-note"],
      ["Organize notes", "write-find-and-organize"],
      ["Share a note", "share-with-a-link"],
      ["Keyboard shortcuts", "commands-and-keyboard-shortcuts"],
    ],
    description:
      "Save your first note, verify it, ask a source-linked question and learn the browser's writing, sharing and recovery controls.",
  },
  {
    slug: "client",
    source: "client.md",
    title: "Agent installation",
    sections: [
      ["CLI", "cli"],
      ["OpenCode", "opencode-v2"],
      ["Claude Code", "claude-code"],
      ["Codex", "codex"],
      ["Other MCP clients", "other-mcp-clients"],
      ["Diagnose a connection", "diagnose-installation-and-startup"],
    ],
    description:
      "Connect OpenCode, Claude Code, Codex and other MCP clients to Grove, review permissions and diagnose setup.",
  },
  {
    slug: "server",
    source: "server.md",
    title: "Memory tools and API",
    sections: [
      ["Authentication", "authentication"],
      ["Memory and notebook tools", "memory-and-notebook-tools"],
      ["REST routes", "rest-routes"],
    ],
    description:
      "Reference for Grove note and notebook tools, authentication, scoped search, revisions and API behavior.",
  },
  {
    slug: "models",
    source: "models.md",
    title: "Models and memory",
    sections: [
      ["Self-hosted configuration", "self-hosted-configuration"],
      ["Account AI preferences", "account-ai-preferences"],
      ["Organization and recall", "organization-summaries-and-recall"],
    ],
    description:
      "How Grove embeddings, organization, generation and provider controls work for Cloud and self-hosted installations.",
  },
  {
    slug: "ask-tools",
    source: "ask-tools.md",
    title: "Ask Grove tools",
    sections: [
      ["Choose tools", "controls-and-workflow"],
      ["Organize notes", "organization"],
      ["Archive or restore notes", "archive-restore-and-delete"],
    ],
    description:
      "Use saved notes, web search and research with cited replies and reviewed note changes in Ask Grove.",
  },
  {
    slug: "hosted-chat",
    source: "hosted-chat.md",
    title: "ChatGPT and Claude web",
    sections: [
      ["ChatGPT", "chatgpt"],
      ["Claude web", "claude-web"],
      ["Approve a connection", "approve-the-right-connection"],
      ["Test save and recall", "check-save-and-recall"],
      ["Troubleshooting", "troubleshooting"],
    ],
    description:
      "Set up custom OAuth connections to Grove in hosted chats, including approval steps and qualification limits.",
  },
] as const;

export function documentationHref(href: string, source: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return href;
  const resolved = new URL(
    href,
    `https://reference.invalid/documentation/${source}`,
  );
  const document = documentation.find(
    (item) => resolved.pathname === `/documentation/${item.source}`,
  );
  return document
    ? `/docs/${document.slug}${resolved.search}${resolved.hash}`
    : `https://github.com/miniaxolotl/grove/blob/production${resolved.pathname}${resolved.search}${resolved.hash}`;
}
