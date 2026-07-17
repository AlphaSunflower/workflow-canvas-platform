import type { ReactNode } from "react";

interface DetailPageShellProps {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function DetailPageShell({
  title,
  eyebrow,
  actions,
  children,
}: DetailPageShellProps): JSX.Element {
  return (
    <section className="page-shell">
      <header className="page-header">
        <div>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h1>{title}</h1>
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
