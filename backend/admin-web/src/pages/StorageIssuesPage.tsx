import { FormEvent, useCallback, useMemo, useState } from "react";
import { adminApi, type AdminStorageIssueListQuery } from "../api/admin-api.ts";
import type { AppNavigation } from "../App.tsx";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { compactId, fileHash } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface StorageIssuesPageProps {
  navigation: AppNavigation;
  onUnauthorized: () => void;
}

const PAGE_SIZE = 20;

export function StorageIssuesPage({
  navigation,
  onUnauthorized,
}: StorageIssuesPageProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    severity: "",
    type: "",
  });
  const [draft, setDraft] = useState(filters);

  const query = useMemo<AdminStorageIssueListQuery>(() => ({
    page,
    pageSize: PAGE_SIZE,
    severity: filters.severity as AdminStorageIssueListQuery["severity"] || undefined,
    type: filters.type || undefined,
  }), [filters, page]);

  const { data, loading, error } = useAdminData(
    () => adminApi.listStorageIssues(query),
    [query],
    onUnauthorized,
  );

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }, [draft]);

  return (
    <DetailPageShell title="存储问题" eyebrow="Storage Issues">
      <form className="filter-bar" onSubmit={handleSubmit}>
        <select
          value={draft.severity}
          onChange={(event) => setDraft((current) => ({ ...current, severity: event.target.value }))}
        >
          <option value="">全部等级</option>
          <option value="warning">warning</option>
          <option value="error">error</option>
        </select>
        <input
          placeholder="问题类型"
          value={draft.type}
          onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
        />
        <button className="secondary-button" type="submit">筛选</button>
      </form>
      <DataState loading={loading} error={error} empty={Boolean(data && data.items.length === 0)} emptyText="未发现存储问题" />
      {data ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>等级</th>
                  <th>类型</th>
                  <th>File</th>
                  <th>Blob</th>
                  <th>Storage Key</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((issue) => (
                  <tr key={issue.id}>
                    <td><StatusBadge value={issue.severity} /></td>
                    <td>{issue.type}</td>
                    <td><EntityLink label={compactId(issue.fileId)} hash={issue.fileId ? fileHash(issue.fileId) : null} onNavigate={navigation.navigate} /></td>
                    <td className="mono">{compactId(issue.blobId)}</td>
                    <td className="mono wrap">{issue.storageKey ?? "-"}</td>
                    <td>{issue.message}</td>
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
