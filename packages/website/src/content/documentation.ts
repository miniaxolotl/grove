// Explicitly published reference documents, never an index of the whole repository.
export const documentation = [
  {
    slug: "client",
    source: "client.md",
    title: "Agent installation",
    description:
      "Connect OpenCode, Claude Code, Codex and other MCP clients to Grove, review permissions and diagnose setup.",
  },
  {
    slug: "server",
    source: "server.md",
    title: "Memory tools and API",
    description:
      "Reference for Grove note and notebook tools, authentication, scoped search, revisions and API behavior.",
  },
  {
    slug: "models",
    source: "models.md",
    title: "Models and organized memory",
    description:
      "How Grove embeddings, organization, generation and provider controls work for Cloud and self-hosted installations.",
  },
  {
    slug: "ask-tools",
    source: "ask-tools.md",
    title: "Ask Grove tools",
    description:
      "Use saved notes, web search and research with cited replies and reviewed note changes in Ask Grove.",
  },
  {
    slug: "hosted-chat",
    source: "hosted-chat.md",
    title: "ChatGPT and Claude web",
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
