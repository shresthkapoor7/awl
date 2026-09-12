import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 19 11.5 4H16l-3.3 6.5H20L12.2 20H7.5l4.4-6H9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusDot({ active = false }: { active?: boolean }) {
  return (
    <span
      className={`status-dot ${active ? "active" : ""}`}
      aria-hidden="true"
    />
  );
}
