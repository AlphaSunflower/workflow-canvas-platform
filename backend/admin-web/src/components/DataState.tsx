interface DataStateProps {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
}

export function DataState({
  loading,
  error,
  empty,
  emptyText = "暂无数据",
}: DataStateProps): JSX.Element | null {
  if (loading) {
    return (
      <div className="state-line">
        <div className="spinner small" />
        <span>加载中</span>
      </div>
    );
  }

  if (error) {
    return <div className="state-line error">{error}</div>;
  }

  if (empty) {
    return <div className="state-line">{emptyText}</div>;
  }

  return null;
}
