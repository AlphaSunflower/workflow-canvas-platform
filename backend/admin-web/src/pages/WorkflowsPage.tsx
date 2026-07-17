import { FormEvent, useCallback, useMemo, useState } from "react";
import { adminApi, type AdminWorkflowListQuery } from "../api/admin-api.ts";
import type { AppNavigation } from "../App.tsx";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { compactId, formatDateTime, workflowHash } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface WorkflowsPageProps {
  navigation: AppNavigation;
  onUnauthorized: () => void;
}

const PAGE_SIZE = 20;

export function WorkflowsPage({ navigation, onUnauthorized }: WorkflowsPageProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    q: "",
    ownerUserId: "",
    groupId: "",
  });
  const [draft, setDraft] = useState(filters);

  const query = useMemo<AdminWorkflowListQuery>(() => ({
    page,
    pageSize: PAGE_SIZE,
    q: filters.q || undefined,
    ownerUserId: filters.ownerUserId || undefined,
    groupId: filters.groupId || undefined,
  }), [filters, page]);

  const { data, loading, error } = useAdminData(
    () => adminApi.listWorkflows(query),
    [query],
    onUnauthorized,
  );

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }, [draft]);

  return (
    <DetailPageShell title="Workflow" eyebrow="Workflows">
      <form className="filter-bar" onSubmit={handleSubmit}>
        <input
          placeholder="搜索名称"
          value={draft.q}
          onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
        />
        <input
          placeholder="Owner User ID"
          value={draft.ownerUserId}
          onChange={(event) => setDraft((current) => ({ ...current, ownerUserId: event.target.value }))}
        />
        <input
          placeholder="Group ID"
          value={draft.groupId}
          onChange={(event) => setDraft((current) => ({ ...current, groupId: event.target.value }))}
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
                  <th>Workflow</th>
                  <th>名称</th>
                  <th>Owner</th>
                  <th>节点/连线</th>
                  <th>Group</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((workflow) => (
                  <tr key={workflow.workflowId}>
                    <td><EntityLink label={compactId(workflow.workflowId)} hash={workflowHash(workflow.workflowId)} onNavigate={navigation.navigate} /></td>
                    <td>
                      <div className="strong-text">{workflow.name}</div>
                      <div className="muted">{workflow.projectId}</div>
                    </td>
                    <td className="mono">{compactId(workflow.ownerUserId)}</td>
                    <td>{workflow.nodeCount} / {workflow.connectionCount}</td>
                    <td className="mono">{compactId(workflow.groupId)}</td>
                    <td>{formatDateTime(workflow.updatedAt)}</td>
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
