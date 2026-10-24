import type { ComponentProps } from "react";
import { GroveMark } from "./brand";
import { RecoveryState } from "./recovery-state";

export function RecoveryPage(
  props: Omit<
    ComponentProps<typeof RecoveryState>,
    "heading" | "compact" | "announce"
  >,
) {
  return (
    <div className="recovery-page">
      <header className="recovery-header">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- This shell also renders outside the app router in global-error. */}
        <a href="/" className="recovery-brand" aria-label="Grove home">
          <GroveMark />
          <span>Grove</span>
        </a>
      </header>
      <main id="main" className="recovery-main">
        <RecoveryState {...props} heading="h1" announce={false} />
      </main>
      <footer className="recovery-footer">
        <span>Need a hand?</span>
        {/* Full navigation also works when the app router itself has failed. */}
        <a href="/support">Get in touch</a>
      </footer>
    </div>
  );
}
