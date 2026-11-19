import { useMemo } from "react";
import type { Project } from "@/lib/dashboard-api";
import { notebookOptions } from "@/lib/notebooks";
import type { SelectProps, SelectOption } from "./ui/select";
import { NotebookPicker } from "./notebook-picker";
import "./note-form.css";

export function NotebookSelect({
  projects,
  exclude,
  showHierarchy = false,
  leading = [{ value: "", label: "Unfiled" }],
  ...props
}: Omit<SelectProps, "options"> & {
  projects: readonly Project[];
  exclude?: string;
  showHierarchy?: boolean;
  leading?: readonly SelectOption[];
}) {
  const notebooks = useMemo(
    () => notebookOptions(projects, exclude),
    [projects, exclude],
  );
  const options = showHierarchy
    ? notebooks.map((item) => ({
        ...item,
        displayLabel: item.parentPath ? (
          <span className="notebook-choice" title={item.label}>
            <span className="notebook-choice-path">{item.parentPath} / </span>
            <strong>{item.name}</strong>
          </span>
        ) : (
          item.name
        ),
      }))
    : notebooks;
  return <NotebookPicker {...props} options={[...leading, ...options]} />;
}
