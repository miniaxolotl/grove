import {
  Archive,
  ArchiveRestore,
  BookOpen,
  CalendarDays,
  Download,
  FilePlus2,
  Focus,
  FolderInput,
  History,
  Keyboard,
  MessageSquare,
  PanelRight,
  Pencil,
  Save,
  Settings,
  Share2,
  Trash2,
} from "lucide-react";
import type { WorkspaceCommand } from "@/lib/workspace-commands";

const icons = {
  edit: Pencil,
  save: Save,
  focus: Focus,
  properties: PanelRight,
  share: Share2,
  history: History,
  move: FolderInput,
  export: Download,
  archive: Archive,
  restore: ArchiveRestore,
  delete: Trash2,
  new: FilePlus2,
  today: CalendarDays,
  notes: BookOpen,
  ask: MessageSquare,
  settings: Settings,
  help: Keyboard,
};

export function CommandIcon({ name }: { name: WorkspaceCommand["icon"] }) {
  const Icon = icons[name];
  return <Icon size={17} strokeWidth={1.6} aria-hidden="true" />;
}
