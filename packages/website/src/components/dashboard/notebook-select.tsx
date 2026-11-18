import type { Project } from "@/lib/dashboard-api";
import { notebookOptions } from "@/lib/notebooks";
import { Select, type SelectProps, type SelectOption } from "./ui/select";
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
  const notebooks = notebookOptions(projects, exclude);
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
  return <Select {...props} options={[...leading, ...options]} />;
}
