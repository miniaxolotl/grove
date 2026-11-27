"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
import type { ConversationTurn } from "@lib/shared/conversations";
import type { SourceSelection } from "./ask-sources";
import { deferredFeature } from "./deferred-feature";
import { Shortcut } from "./ui/shortcut";
import {
  matchesShortcut,
  shortcutHint,
  shortcuts,
} from "@/lib/workspace-shortcuts";

const SearchDialog = deferredFeature(
  () => import("./workspace-search-dialog"),
  "Opening search…",
);

export type AskSession = {
  conversationDrafts?: Record<
    string,
    {
      draft: string;
      unconfirmed?: ConversationTurn;
      scope?: string;
      includePersonal?: boolean;
      sources?: SourceSelection;
      rejected?: { question: string; sources: SourceSelection };
    }
  >;
  scope: string;
  includePersonal: boolean;
  draft: string;
  sources?: SourceSelection;
  rejected?: { question: string; sources: SourceSelection };
  conversationId?: string;
  unconfirmed?: ConversationTurn;
  query: string;
  searchStopped?: boolean;
  mode: "answer" | "search";
};
export const paletteSessionKey = (id: string) => `ask:palette:${id}`;
const Context = createContext<{
  open: () => void;
  sessions: Map<string, AskSession>;
} | null>(null);
export const useWorkspaceSearch = () => useContext(Context);

export function WorkspaceSearch({ children }: { children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  const [sessions] = useState(() => new Map<string, AskSession>());
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        matchesShortcut(event, shortcuts.search) &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        setOpened(true);
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  return (
    <Context.Provider value={{ open: () => setOpened(true), sessions }}>
      {children}
      {opened && <SearchDialog close={() => setOpened(false)} />}
    </Context.Provider>
  );
}
export function WorkspaceSearchButton() {
  const context = useWorkspaceSearch();
  return (
    <button
      type="button"
      className="workspace-search-launcher"
      aria-label="Search anything"
      title={`Search anything (${shortcutHint(shortcuts.search)})`}
      onClick={context?.open}
    >
      <Search size={16} aria-hidden="true" />
      <span>Search anything</span>
      <Shortcut>{shortcuts.search}</Shortcut>
    </button>
  );
}
