type Condition =
  | { key: string; value: string }
  | { key: string; any: string[] }
  | undefined
  | null;

export function buildFilter(
  conditions: Condition[],
): Record<string, unknown> | undefined {
  const must: Record<string, unknown>[] = [];
  for (const cond of conditions) {
    if (!cond) continue;
    if ("value" in cond) {
      must.push({ key: cond.key, match: { value: cond.value } });
    } else if (cond.any.length > 0) {
      must.push({ key: cond.key, match: { any: cond.any } });
    }
  }
  return must.length > 0 ? { must } : undefined;
}
