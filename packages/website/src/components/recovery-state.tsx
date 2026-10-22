import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import "./recovery.css";

export function RecoveryState({
  title,
  description,
  actions,
  icon = <FileText size={22} strokeWidth={1.5} />,
  label,
  compact = false,
  heading: Heading = "h2",
  announce = true,
}: {
  title: string;
  description: string;
  actions: ReactNode;
  icon?: ReactNode;
  label?: string;
  compact?: boolean;
  heading?: "h1" | "h2";
  announce?: boolean;
}) {
  return (
    <div className={`recovery-state${compact ? " is-compact" : ""}`}>
      <span className="recovery-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="recovery-copy" role={announce ? "alert" : undefined}>
        {label && <p className="recovery-label">{label}</p>}
        <Heading className="recovery-title">{title}</Heading>
        <p className="recovery-description">{description}</p>
      </div>
      <div className="recovery-actions">{actions}</div>
    </div>
  );
}
