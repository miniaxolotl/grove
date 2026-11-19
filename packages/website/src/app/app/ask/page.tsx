"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AskGrove } from "@/components/dashboard/ask-grove";
import {
  paletteSessionKey,
  useWorkspaceSearch,
} from "@/components/dashboard/workspace-search";

export default function AskPage() {
  const id = useSearchParams().get("draft");
  const workspace = useWorkspaceSearch();
  if (id === null) return <AskGrove />;
  const sessionKey = paletteSessionKey(id);
  if (!workspace?.sessions.has(sessionKey))
    return (
      <p>
        This search draft is no longer available.{" "}
        <Link href="/app/ask">Open Ask Grove</Link>
      </p>
    );
  return <AskGrove key={sessionKey} sessionKey={sessionKey} />;
}
