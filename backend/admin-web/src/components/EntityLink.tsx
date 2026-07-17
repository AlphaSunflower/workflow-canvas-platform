interface EntityLinkProps {
  label: string | null | undefined;
  hash?: string | null;
  onNavigate?: (hash: string) => void;
}

export function EntityLink({
  label,
  hash,
  onNavigate,
}: EntityLinkProps): JSX.Element {
  if (!label) {
    return <span className="muted">-</span>;
  }

  if (!hash || !onNavigate) {
    return <span className="mono">{label}</span>;
  }

  return (
    <button
      type="button"
      className="link-button mono"
      onClick={() => onNavigate(hash)}
    >
      {label}
    </button>
  );
}
