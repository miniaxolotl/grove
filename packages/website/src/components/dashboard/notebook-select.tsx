import type { Project } from "@/lib/dashboard-api";
import { notebookOptions } from "@/lib/notebooks";
import { Select, type SelectProps, type SelectOption } from "./ui/select";

export function NotebookSelect({
  projects,
  exclude,
  leading = [{ value: "", label: "Unfiled" }],
  ...props
}: Omit<SelectProps, "options"> & {
  projects: readonly Project[];
  exclude?: string;
  leading?: readonly SelectOption[];
}) {
  return (
    <Select
      {...props}
      options={[...leading, ...notebookOptions(projects, exclude)]}
    />
  );
}
