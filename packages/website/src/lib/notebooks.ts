import type { Project } from "./dashboard-api";

/** One stable sibling order across the manager, explorer and sub-notebooks. */
export function notebookOrder(a: Project, b: Project) {
  return (
    (a.position ?? 0) - (b.position ?? 0) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

/** Resolves only visible ancestors; missing parents never disclose another scope. */
export function notebookPath(projects: readonly Project[], id?: string | null) {
  const byId = new Map(projects.map((project) => [project.id, project]));
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
  return projects
    .map((project) => ({ project, path: notebookPath(projects, project.id) }))
    .filter(
      ({ path }) => !exclude || !path.some((project) => project.id === exclude),
    )
    .map(({ project, path }) => ({
      value: project.id,
      label: path.map((p) => p.name).join(" / "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
