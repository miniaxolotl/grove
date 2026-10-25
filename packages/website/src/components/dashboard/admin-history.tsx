import type { AdminAudit } from "@lib/shared/system-admin";

export const accessName = {
  default: "Standard",
  pro: "Pro",
  unlimited: "Unlimited",
};
export const roleName = { user: "User", system_admin: "System admin" };
export const shortDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function adminChanges(entry: AdminAudit): string[] {
  const changes: string[] = [];
  if (entry.kind === "bootstrap") return ["System administrator set up"];
  if (entry.before.access !== entry.after.access)
    changes.push(
      `Access: ${accessName[entry.before.access]} → ${accessName[entry.after.access]}`,
    );
  if (entry.before.role !== entry.after.role)
    changes.push(
      `Role: ${roleName[entry.before.role]} → ${roleName[entry.after.role]}`,
    );
  const before = entry.before.settings;
  const after = entry.after.settings;
  if (before && after) {
    if (before.captureEnabled !== after.captureEnabled)
      changes.push(
        `Automatic capture ${after.captureEnabled ? "enabled" : "disabled"}`,
      );
    if (before.recallEnabled !== after.recallEnabled)
      changes.push(
        `Automatic recall ${after.recallEnabled ? "enabled" : "disabled"}`,
      );
    if (before.suspended !== after.suspended)
      changes.push(after.suspended ? "Account suspended" : "Account restored");
    if (before.supportNote !== after.supportNote)
      changes.push("Support note updated");
  }
  return changes.length ? changes : ["Account settings updated"];
}

export function AdminHistory({
  entries,
  accountOnly = false,
}: {
  entries: AdminAudit[];
  accountOnly?: boolean;
}) {
  return entries.length ? (
    <ol className="admin-history-list">
      {entries.map((entry) => (
        <li key={entry.id}>
          {!accountOnly ? <strong>{entry.after.subject}</strong> : null}
          <ul className="admin-change-fields">
            {adminChanges(entry).map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
          <p>{entry.reason}</p>
          <div className="admin-caption">
            <time dateTime={entry.createdAt}>{shortDate(entry.createdAt)}</time>
            <span>By {entry.actorId ?? "Owner setup"}</span>
          </div>
        </li>
      ))}
    </ol>
  ) : (
    <p className="admin-caption">
      {accountOnly
        ? "No changes for this account in the latest 50 administration entries."
        : "No administration changes yet."}
    </p>
  );
}
