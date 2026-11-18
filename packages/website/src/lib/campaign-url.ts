/** Build a public measurement URL without forwarding arbitrary query values. */
export function campaignUrl(
  raw: string,
  origin: string,
  paths: ReadonlySet<string>,
): string | null {
  try {
    const input = new URL(raw, origin);
    const path = input.pathname.replace(/\/$/, "") || "/";
    if (input.origin !== origin || !paths.has(path)) return null;
    const output = new URL(path, origin);
    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
    ]) {
      const values = input.searchParams.getAll(key);
      const value = values[0];
      if (
        values.length === 1 &&
        value &&
        /^[a-z][a-z0-9_-]{0,63}$/i.test(value)
      )
        output.searchParams.set(key, value);
    }
    return output.href;
  } catch {
    return null;
  }
}

/** Vendor scripts may inspect the document, not just the projected event URL. */
export function publicCampaignDocument(
  raw: string,
  origin: string,
  paths: ReadonlySet<string>,
): boolean {
  try {
    const input = new URL(raw);
    const projected = campaignUrl(raw, origin, paths);
    if (!projected || input.hash || input.username || input.password)
      return false;
    const output = new URL(projected);
    return [...input.searchParams].every(
      ([key, value]) =>
        input.searchParams.getAll(key).length === 1 &&
        output.searchParams.get(key) === value,
    );
  } catch {
    return false;
  }
}
