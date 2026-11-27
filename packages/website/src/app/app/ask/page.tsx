"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AskGrove } from "@/components/dashboard/ask-grove";
import {
  paletteSessionKey,
  useWorkspaceSearch,
} from "@/components/dashboard/workspace-search";

export default function AskPage() {
  const params = useSearchParams();
  const id = params.get("draft");
  const chat = params.get("chat");
  const workspace = useWorkspaceSearch();
  if (id === null) return <AskGrove locationChat={chat} />;
  const sessionKey = paletteSessionKey(id);
  if (!workspace?.sessions.has(sessionKey))
    return (
      <p>
        This search draft is no longer available.{" "}
        <Link href="/app/ask">Open Ask Grove</Link>
      </p>
    );
  return (
    <AskGrove key={sessionKey} sessionKey={sessionKey} locationChat={chat} />
  );
}
