import type { Project } from "./dashboard-api";

export const notebookDisplaySortOptions = [
  { value: "custom", label: "Saved order" },
  { value: "title_asc", label: "Name A–Z" },
  { value: "title_desc", label: "Name Z–A" },
  { value: "created_desc", label: "Newest created" },
  { value: "created_asc", label: "Oldest created" },
] as const;
export type NotebookDisplaySort =
  (typeof notebookDisplaySortOptions)[number]["value"];
export function notebookDisplayOrder(sort: NotebookDisplaySort) {
  if (sort === "custom") return notebookOrder;
  return (a: Project, b: Project) => {
    if (sort.startsWith("title_"))
      return (
        (sort === "title_asc" ? 1 : -1) * a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    const left = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const right = b.createdAt ? Date.parse(b.createdAt) : NaN;
    // Missing legacy dates stay last in both directions, never borrow a child's date.
    if (!Number.isFinite(left) || !Number.isFinite(right))
      return Number.isFinite(left)
        ? -1
        : Number.isFinite(right)
          ? 1
          : a.id.localeCompare(b.id);
    return (
      (sort === "created_asc" ? 1 : -1) * (left - right) ||
      a.id.localeCompare(b.id)
    );
  };
}

/** One stable sibling order across the manager, explorer and sub-notebooks. */
export function notebookOrder(a: Project, b: Project) {
  return (
    (a.position ?? 0) - (b.position ?? 0) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

/** Resolves only visible ancestors; missing parents never disclose another scope. */
export function notebookPath(
  projects: readonly Project[],
  id?: string | null,
  byId: ReadonlyMap<string, Project> = new Map(
    projects.map((project) => [project.id, project]),
  ),
) {
  const path: Project[] = [];
  const seen = new Set<string>();
  while (id && byId.has(id) && !seen.has(id)) {
    seen.add(id);
    const project = byId.get(id)!;
    path.unshift(project);
    id = project.parentId;
  }
  return path;
}

export function notebookOptions(
  projects: readonly Project[],
  exclude?: string,
) {
  const byId = new Map(projects.map((project) => [project.id, project]));
  return projects
    .map((project) => ({
      project,
      path: notebookPath(projects, project.id, byId),
    }))
    .filter(
      ({ path }) => !exclude || !path.some((project) => project.id === exclude),
    )
    .map(({ project, path }) => ({
      value: project.id,
      label: path.map((p) => p.name).join(" / "),
      name: project.name,
      parentPath: path
        .slice(0, -1)
        .map((p) => p.name)
        .join(" / "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
