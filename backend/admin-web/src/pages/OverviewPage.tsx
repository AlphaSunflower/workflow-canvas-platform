import { adminApi } from "../api/admin-api.ts";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { useAdminData } from "../components/useAdminData.ts";

interface OverviewPageProps {
  onUnauthorized: () => void;
}

export function OverviewPage({ onUnauthorized }: OverviewPageProps): JSX.Element {
  const { data, loading, error } = useAdminData(
    () => adminApi.getOverview(),
    [],
    onUnauthorized,
  );

  return (
    <DetailPageShell title="总览" eyebrow="Admin Overview">
      <DataState loading={loading} error={error} />
      {data ? (
        <div className="metric-grid">
          <section className="metric-card">
            <span>文件资产</span>
            <strong>{data.files.total}</strong>
            <small>ready {data.files.ready} / pending {data.files.pendingUpload}</small>
          </section>
          <section className="metric-card">
            <span>执行 Run</span>
            <strong>{data.executions.totalRuns}</strong>
            <small>queued {data.executions.queuedTasks} / processing {data.executions.processingTasks} / failed {data.executions.failedTasks}</small>
          </section>
          <section className="metric-card">
            <span>Workflow</span>
            <strong>{data.workflows.total}</strong>
            <small>已入库或 JSON 可读记录</small>
          </section>
          <section className="metric-card">
            <span>用户</span>
            <strong>{data.users.total}</strong>
            <small>admin {data.users.admins} / member {data.users.members} / disabled {data.users.disabled}</small>
          </section>
          <section className="metric-card warning">
            <span>存储问题</span>
            <strong>{data.storage.issueCount}</strong>
            <small>warning/error 聚合</small>
          </section>
        </div>
      ) : null}
    </DetailPageShell>
  );
}
