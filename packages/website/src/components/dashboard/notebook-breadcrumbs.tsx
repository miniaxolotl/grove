import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Project } from "@/lib/dashboard-api";
import { notebookPath } from "@/lib/notebooks";

export function NotebookBreadcrumbs({
  projects,
  id,
  current = false,
}: {
  projects: readonly Project[];
  id?: string | null;
  current?: boolean;
}) {
  const path = notebookPath(projects, id);
  return (
    <nav className="notebook-breadcrumbs" aria-label="Notebook path">
      <ol>
        <li>
          <Link href="/app/projects">Notebooks</Link>
        </li>
        {(path.length ? path : [{ id: "personal", name: "Personal" }]).map(
          (project, index) => (
            <li key={project.id}>
              <ChevronRight size={12} aria-hidden="true" />
              {current && index === path.length - 1 ? (
                <span aria-current="page">{project.name}</span>
              ) : (
                <Link
                  href={
                    project.id === "personal"
                      ? "/app/profile"
                      : `/app/projects/${project.id}`
                  }
                >
                  {project.name}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
