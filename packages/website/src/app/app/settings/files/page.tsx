import { Suspense } from "react";
import { FilesPanel } from "@/components/dashboard/files-panel";
export default function FilesPage() {
  return (
    <Suspense fallback={<p role="status">Opening files…</p>}>
      <FilesPanel />
    </Suspense>
  );
}
