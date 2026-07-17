interface StatusBadgeProps {
  value: string | null | undefined;
}

const POSITIVE = new Set(["ready", "completed", "enabled", "admin"]);
const WARNING = new Set(["pending_upload", "queued", "processing", "warning"]);
const DANGER = new Set(["failed", "cancelled", "disabled", "error"]);

export function StatusBadge({ value }: StatusBadgeProps): JSX.Element {
  const text = value ?? "-";
  let tone = "neutral";
  if (POSITIVE.has(text)) {
    tone = "positive";
  } else if (WARNING.has(text)) {
    tone = "warning";
  } else if (DANGER.has(text)) {
    tone = "danger";
  }

  return <span className={`status-badge ${tone}`}>{text}</span>;
}
