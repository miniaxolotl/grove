import type { ReactNode } from "react";

export function Disclosure({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`app-disclosure ${className}`}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}
