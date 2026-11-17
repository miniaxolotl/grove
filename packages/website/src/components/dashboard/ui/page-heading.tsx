import type { ReactNode } from "react";

export function PageHeading({
  title,
  description,
  actions,
  compact = false,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const Heading = compact ? "h2" : "h1";
  return (
    <header
      className={["app-page-heading", compact && "compact-heading", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div>
        <Heading>{title}</Heading>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </header>
  );
}
