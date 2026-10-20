"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useNotebooks } from "./notebooks-provider";
import { NotebookTree } from "./notebook-tree";
import { NotebookDialog } from "./notebook-dialog";
import { IconButton } from "./ui/button";

export function NotebookExplorer() {
  const { projects, loading, error, reload } = useNotebooks();
  const path = usePathname();
  const [create, setCreate] = useState(false);
  return (
    <section className="notebook-explorer" aria-label="Your notebooks">
      <div className="notebook-explorer-heading">
        <Link href="/app/projects">Your notebooks</Link>
        <IconButton label="Create notebook" onClick={() => setCreate(true)}>
          <Plus size={14} />
        </IconButton>
      </div>
      {loading ? (
        <p className="notebook-tree-message">Opening notebooks…</p>
      ) : error ? (
        <button className="text-button" onClick={reload}>
          Retry notebooks
        </button>
      ) : projects.length ? (
        <NotebookTree
          projects={projects}
          selectedId={
            path.startsWith("/app/projects/") ? path.split("/")[3] : null
          }
        />
      ) : (
        <p className="notebook-tree-message">
          A place for every idea.
          <br />
          <button className="text-button" onClick={() => setCreate(true)}>
            Create a notebook
          </button>
        </p>
      )}
      {create && <NotebookDialog action={{}} close={() => setCreate(false)} />}
    </section>
  );
}
