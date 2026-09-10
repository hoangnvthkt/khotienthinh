import React from "react";

export function WorkTaskSection({
  title,
  hint,
  actions,
  className = "",
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`work-section work-task-section ${className}`.trim()}>
      <header className="work-task-section-header">
        <div>
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
        {actions && <div className="work-task-section-actions">{actions}</div>}
      </header>
      <div className="work-task-section-body">{children}</div>
    </section>
  );
}
