import type { ReactNode } from "react";

interface InfoItem {
  label: string;
  value: ReactNode;
}

interface InfoGridProps {
  items: InfoItem[];
}

export function InfoGrid({ items }: InfoGridProps): JSX.Element {
  return (
    <dl className="info-grid">
      {items.map((item) => (
        <div className="info-item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}
