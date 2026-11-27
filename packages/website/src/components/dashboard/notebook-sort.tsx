"use client";
import { ArrowDownAZ, Check } from "lucide-react";
import {
  notebookDisplaySortOptions,
  type NotebookDisplaySort,
} from "@/lib/notebooks";
import { useNotebooks } from "./notebooks-provider";
import { useWorkspaceNavigationState } from "./workspace-navigation-state";
import { Select } from "./ui/select";
import { ActionMenu } from "./ui/action-menu";

export function NotebookSort({ compact = false }: { compact?: boolean }) {
  const { displaySort, setDisplaySort } = useNotebooks();
  const navigation = useWorkspaceNavigationState();
  return compact ? (
    <ActionMenu
      label="Notebook display order"
      icon={<ArrowDownAZ size={16} aria-hidden="true" />}
    >
      {notebookDisplaySortOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={displaySort === option.value}
          disabled={!!navigation && !navigation.ready}
          onClick={() => setDisplaySort(option.value)}
        >
          <Check
            size={15}
            aria-hidden="true"
            style={{
              visibility: displaySort === option.value ? "visible" : "hidden",
            }}
          />
          {option.label}
        </button>
      ))}
    </ActionMenu>
  ) : (
    <Select
      aria-label="Notebook display order"
      value={displaySort}
      onValueChange={(value) => setDisplaySort(value as NotebookDisplaySort)}
      options={notebookDisplaySortOptions}
      disabled={!!navigation && !navigation.ready}
    />
  );
}
