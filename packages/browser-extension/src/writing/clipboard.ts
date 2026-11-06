/** Start within the explicit click gesture; clipboard failure never undoes an edit. */
export function copyWritingChoice(
  text: string,
  feedback?: (message: string) => void,
) {
  try {
    const copied = navigator.clipboard?.writeText(text);
    if (!copied) {
      feedback?.("Text replaced. Clipboard unavailable.");
      return;
    }
    void copied.then(
      () => feedback?.("Copied and replaced"),
      () => feedback?.("Text replaced. Clipboard unavailable."),
    );
  } catch {
    feedback?.("Text replaced. Clipboard unavailable.");
  }
}
