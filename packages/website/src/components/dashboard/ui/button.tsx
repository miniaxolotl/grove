import type { ButtonHTMLAttributes } from "react";

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      type={type}
      className={`app-button ${variant} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      className={`app-icon ${className}`}
      aria-label={label}
      title={label}
      {...props}
    />
  );
}
