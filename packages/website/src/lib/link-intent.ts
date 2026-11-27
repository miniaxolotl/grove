/** Common intent rules; callers retain their own authorized caches and budgets. */
export function canWarmLink(href: string) {
  return (
    new URL(href, location.origin).origin === location.origin &&
    !(navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData
  );
}
