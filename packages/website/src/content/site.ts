export const navigation = [
  { label: "Why Grove", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Get started", href: "/#install" },
];

export const faqs = [
  {
    question: "What exactly is Grove?",
    answer:
      "Grove is private memory for everyday agent conversations and tasks. Keep preferences, confirmed decisions, useful facts, verified solutions, and short task handoffs. Four tools and a memory library help you pick up where you left off.",
  },
  {
    question: "Which agents can use it?",
    answer:
      "Grove includes packages for OpenCode V2, Claude Code, and Codex. Each uses an authenticated API connection. Other MCP clients can use the remote endpoint or the packaged stdio bridge. Hook support depends on the client; explicit memory tools are always available.",
  },
  {
    question: "Does it remember everything automatically?",
    answer:
      "Grove keeps concise, useful context through explicit tool calls. Optional hooks retrieve a small profile at task start; they never upload raw conversations or tool logs. Pause automatic memory locally or in Settings. You can inspect every saved memory in your library.",
  },
  {
    question: "Where does my data go?",
    answer:
      "Memories are stored in private PostgreSQL behind Grove’s authenticated API. Account ownership and database row security keep users separated. Embeddings run on the Grove server by default. Your AI client receives the context you recall and follows its own data settings. Server-side search is not end-to-end encryption.",
  },
  {
    question: "Is Grove free?",
    answer:
      "Grove is open source under the MIT license. Self-hosting uses your own compute, PostgreSQL storage, and Clerk configuration. Hosting and identity providers may have their own costs.",
  },
  {
    question: "What do I need to get started?",
    answer:
      "Create an account on your Grove deployment, install the CLI with Node.js 22 or newer, and run grove init for your agent. Browser sign-in or a scoped API key connects the agent. Self-hosting uses Docker Compose, PostgreSQL with pgvector, and a dedicated Clerk application.",
  },
  {
    question: "Can I organize or remove memories?",
    answer:
      "Yes. Browse personal and project memories, correct them with revision history, archive them reversibly, or delete them permanently. Durable memories stay until changed or deleted. Temporary handoffs leave recall after 30 days and are purged after 90 days. Each agent gets only its approved scope.",
  },
];
