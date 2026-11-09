/** Start within the explicit click gesture; clipboard failure never undoes an edit. */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function copyWritingChoice(
  text: string,
  feedback?: (message: string) => void,
) {
  void copyText(text).then((ok) =>
    feedback?.(
      ok ? "Copied and replaced" : "Text replaced. Clipboard unavailable.",
    ),
  );
}
