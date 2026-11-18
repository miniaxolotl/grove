// Extract the technical cause without copying user input embedded in SDK messages.
export function errorSummary(message: string | undefined, route: string) {
  const text = message ?? "";
  if (
    [
      "Invalid upload response",
      "Image unavailable",
      "Shared content is temporarily unavailable",
    ].includes(text)
  )
    return `${text} on ${route}`;
  const cause =
    /^(Failed to fetch|fetch failed|NetworkError when attempting to fetch resource\.?|Load failed)$/i.test(
      text,
    )
      ? "Network request failed"
      : /^(?:Loading chunk .* failed|Failed to fetch dynamically imported module)/.test(
            text,
          )
        ? "JavaScript chunk failed to load"
        : /^Cannot read properties of (null|undefined)/.test(text)
          ? "Property access on a null or undefined value"
          : /^Maximum call stack size exceeded$/.test(text)
            ? "Maximum call stack size exceeded"
            : /^Unexpected end of JSON input$/.test(text)
              ? "Incomplete JSON response"
              : "Unhandled website exception";
  return `${cause} on ${route}`;
}
