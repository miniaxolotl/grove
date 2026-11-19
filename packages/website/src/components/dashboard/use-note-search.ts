import { useQuery } from "@tanstack/react-query";
import type { AskResult } from "@lib/shared/models";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useWorkspaceCache } from "./workspace-cache";

export function useNoteSearch(
  phrase: string,
  projectId: string | null | undefined,
  includePersonal: boolean,
  active: boolean,
) {
  const cache = useWorkspaceCache();
  const search = useDebouncedValue(phrase);
  const enabled = active && !!phrase && search === phrase;
  const result = useQuery({
    ...cache.resource<AskResult>("/ask", {
      query: search,
      projectId,
      includePersonal,
      mode: "search",
    }),
    enabled,
    // Detach this observer as soon as the phrase changes or the user stops.
    // The cache aborts its fetch only when nobody else needs the same search.
    subscribed: enabled,
  });
  return { result, ready: enabled && !result.isPending };
}
