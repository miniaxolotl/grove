/** Dependency-free tool vocabulary shared by the browser and service. */
export const askToolCatalog = {
  exa: { label: "Web search", description: "Find current information online" },
  tavily: { label: "Research", description: "Explore topics and read sources" },
  organize: {
    label: "Manage notes",
    description: "Edit notes and organize notebooks",
  },
} as const;
export type AskToolId = keyof typeof askToolCatalog;
export type AskTools = Record<AskToolId, boolean>;
export const defaultAskTools: AskTools = {
  exa: true,
  tavily: false,
  organize: true,
};
export const askToolIds = Object.keys(askToolCatalog) as AskToolId[];
