import { FormEvent, useCallback, useMemo, useState } from "react";
import { adminApi, type AdminExecutionListQuery } from "../api/admin-api.ts";
import type { AppNavigation } from "../App.tsx";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { compactId, executionHash, formatDateTime, workflowHash } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface ExecutionsPageProps {
  navigation: AppNavigation;
  onUnauthorized: () => void;
}

const PAGE_SIZE = 20;

export function ExecutionsPage({ navigation, onUnauthorized }: ExecutionsPageProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    userId: "",
    workflowId: "",
    status: "",
    nodeType: "",
    taskType: "",
  });
  const [draft, setDraft] = useState(filters);

  const query = useMemo<AdminExecutionListQuery>(() => ({
    page,
    pageSize: PAGE_SIZE,
    userId: filters.userId || undefined,
    workflowId: filters.workflowId || undefined,
    status: filters.status as AdminExecutionListQuery["status"] || undefined,
    nodeType: filters.nodeType || undefined,
    taskType: filters.taskType || undefined,
  }), [filters, page]);

  const { data, loading, error } = useAdminData(
    () => adminApi.listExecutions(query),
    [query],
    onUnauthorized,
  );

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }, [draft]);

  return (
    <DetailPageShell title="执行历史" eyebrow="Executions">
      <form className="filter-bar" onSubmit={handleSubmit}>
        <input
          placeholder="User ID"
          value={draft.userId}
          onChange={(event) => setDraft((current) => ({ ...current, userId: event.target.value }))}
        />
        <input
          placeholder="Workflow ID"
          value={draft.workflowId}
          onChange={(event) => setDraft((current) => ({ ...current, workflowId: event.target.value }))}
        />
        <select
          value={draft.status}
          onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="">全部状态</option>
          <option value="queued">queued</option>
          <option value="processing">processing</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
        </select>
        <input
          placeholder="nodeType"
          value={draft.nodeType}
          onChange={(event) => setDraft((current) => ({ ...current, nodeType: event.target.value }))}
        />
        <input
          placeholder="taskType"
          value={draft.taskType}
          onChange={(event) => setDraft((current) => ({ ...current, taskType: event.target.value }))}
        />
        <button className="secondary-button" type="submit">筛选</button>
      </form>
      <DataState loading={loading} error={error} empty={Boolean(data && data.items.length === 0)} />
      {data ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Workflow</th>
                  <th>节点/任务</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>User</th>
                  <th>创建时间</th>
                  <th>完成时间</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((run) => (
                  <tr key={run.runId}>
                    <td>
                      <EntityLink
                        label={run.runNo || compactId(run.runId)}
                        hash={executionHash(run.runId)}
                        onNavigate={navigation.navigate}
                      />
                    </td>
                    <td>
                      <EntityLink
                        label={compactId(run.workflowId)}
                        hash={run.workflowId ? workflowHash(run.workflowId) : null}
                        onNavigate={navigation.navigate}
                      />
                    </td>
                    <td>
                      <div className="strong-text">{run.nodeType}</div>
                      <div className="muted">{run.taskType}</div>
                    </td>
                    <td><StatusBadge value={run.status} /></td>
                    <td>{run.completedTaskCount}/{run.totalTaskCount} failed {run.failedTaskCount}</td>
                    <td className="mono">{compactId(run.userId)}</td>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td>{formatDateTime(run.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </>
      ) : null}
    </DetailPageShell>
  );
}
