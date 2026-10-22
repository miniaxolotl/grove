import { ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { RecoveryPage } from "@/components/recovery-page";

export default function NotFound() {
  return (
    <RecoveryPage
      label="404 · Page not found"
      title="This page isn’t here"
      description="The link may have changed, or the page may no longer be available. Let’s get you back."
      icon={<Search size={22} strokeWidth={1.5} />}
      actions={
        <>
          <Link href="/" className="recovery-button">
            <ArrowLeft size={16} aria-hidden="true" /> Back to Grove
          </Link>
          <Link href="/app" className="recovery-button secondary" prefetch={false}>
            Open your notes
          </Link>
        </>
      }
    />
  );
}
