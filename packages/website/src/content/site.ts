export const navigation = [
  { label: "Why Grove", href: "/#features" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Get started", href: "/#install" },
];

export const faqs = [
  {
    question: "What exactly is Grove?",
    answer:
      "Grove is a persistent memory layer for AI agents, delivered as a Model Context Protocol (MCP) server. Your agent can save useful information, search it by meaning, and connect entities in a knowledge graph. Memories live in Qdrant, so they can outlast a single chat or context window.",
  },
  {
    question: "Which agents can use it?",
    answer:
      "Grove exposes MCP tools over HTTP or stdio, so you can connect a client that supports either transport. OpenCode has a ready-to-copy configuration and an optional companion plugin for manual saves, error capture, staleness checks, and memory compaction. Other clients may use different configuration formats.",
  },
  {
    question: "Does it remember everything automatically?",
    answer:
      "Your agent saves and retrieves memories by calling Grove’s tools. Ask it to remember a decision or search previous context, or add memory instructions to your agent’s workflow. The OpenCode plugin adds error capture and lifecycle hooks; it does not record every conversation or automatically inject all your memories.",
  },
  {
    question: "Where does my data go?",
    answer:
      "Memories are stored in the Qdrant instance you configure. By default, Grove runs embeddings locally with ONNX; the first run downloads the embedding model. Remote embedding and reranking services are optional. Your AI client still follows its own model and data settings.",
  },
  {
    question: "Is Grove free?",
    answer:
      "Grove is open source under the MIT license. There is no Grove subscription or per-memory fee. You provide the compute and storage, and any optional external services have their own costs.",
  },
  {
    question: "What do I need to get started?",
    answer:
      "Use Docker with Compose and Git for the all-in-one setup. For npm, you need Node.js 22 or newer and a running Qdrant instance. Then connect an MCP-compatible agent. The installation guide includes the commands, client configuration, and a first-memory example.",
  },
  {
    question: "Can I organize or remove memories?",
    answer:
      "Yes. Tag memories, attach a project or session, and set an importance score. Search can filter by project and tags. Use the memory tools to update or forget individual memories, compact low-importance entries, or prune by threshold. Project tags are organizational filters, not access-control boundaries.",
  },
];
