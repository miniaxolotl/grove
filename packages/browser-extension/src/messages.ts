/** Never surface server/provider/validation details in extension UI. */
export function userMessage(
  error: unknown,
  fallback = "Couldn’t finish. Try again.",
) {
  const code = (error as { code?: string } | null)?.code;
  if (code === "sharing_permission_required")
    return "Allow sharing links in Grove first.";
  if (
    ["unauthorized", "connection_revoked", "connection_required"].includes(
      code ?? "",
    )
  )
    return "Sign in again to continue.";
  if (code === "forbidden") return "Check your note access in Grove.";
  if (["version_conflict", "operation_conflict"].includes(code ?? ""))
    return "This note changed. Reopen it to continue.";
  if (code === "sharing_unavailable")
    return "Sharing isn’t available right now.";
  if (code === "rate_limited") return "Please wait a moment and try again.";
  return fallback;
}
