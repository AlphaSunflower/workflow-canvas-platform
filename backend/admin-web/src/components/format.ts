export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function compactId(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("zh-CN")
    : "-";
}

export function fileHash(fileId: string): string {
  return `#/files/${encodeURIComponent(fileId)}`;
}

export function executionHash(runId: string): string {
  return `#/executions/${encodeURIComponent(runId)}`;
}

export function workflowHash(workflowId: string): string {
  return `#/workflows/${encodeURIComponent(workflowId)}`;
}
