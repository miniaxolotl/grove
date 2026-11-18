"use client";
import { usePathname } from "next/navigation";
import { WorkspaceRouteSkeleton } from "@/components/dashboard/workspace-opening";

export default function LoadingWorkspace() {
  return <WorkspaceRouteSkeleton path={usePathname()} />;
}
