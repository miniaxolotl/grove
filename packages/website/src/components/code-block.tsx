import { Terminal } from "lucide-react";
import { CopyButton } from "@/components/copy-button";

export function CodeBlock({
  code,
  title,
  light = false,
}: {
  code: string;
  title: string;
  light?: boolean;
}) {
  return (
    <div className={`code-block ${light ? "code-block-light" : ""}`}>
      <div className="flex min-h-13 flex-wrap items-center justify-between gap-2 border-b border-current/10 px-4 sm:px-5">
        <span className="flex items-center gap-2 font-mono text-[11px]">
          <Terminal size={13} /> {title}
        </span>
        <CopyButton text={code} label={`Copy ${title}`} />
      </div>
      <pre
        tabIndex={0}
        aria-label={title}
        className="overflow-x-auto p-4 font-mono text-[11px] leading-[1.95] sm:p-5 sm:text-xs"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
