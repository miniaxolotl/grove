import { useState } from "react";
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
  const ready = enabled && !result.isPending;
  // While a refined phrase loads, keep the last matches from the same scope on
  // screen instead of blanking the list. Clearing the phrase or changing scope
  // drops them, so results from another notebook are never shown as current.
  const scope = `${projectId === undefined ? "*" : (projectId ?? "-")}:${includePersonal}`;
  const [last, setLast] = useState<{
    scope: string;
    query: string;
    data: AskResult;
  }>();
  if (
    ready &&
    result.data &&
    !result.error &&
    (last?.data !== result.data || last.scope !== scope)
  )
    setLast({ scope, query: search, data: result.data });
  else if (!phrase && last) setLast(undefined);
  const previous =
    active &&
    phrase &&
    !ready &&
    last?.scope === scope &&
    last.data.sources.length
      ? last
      : undefined;
  return { result, ready, previous };
}
