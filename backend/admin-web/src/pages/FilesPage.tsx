import { FormEvent, useCallback, useMemo, useState } from "react";
import { adminApi, type AdminFileListQuery } from "../api/admin-api.ts";
import type { AppNavigation } from "../App.tsx";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { compactId, fileHash, formatBytes, formatDateTime } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface FilesPageProps {
  navigation: AppNavigation;
  onUnauthorized: () => void;
}

const PAGE_SIZE = 20;

export function FilesPage({ navigation, onUnauthorized }: FilesPageProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    q: "",
    status: "",
    fileType: "",
    sourceType: "",
    userId: "",
  });
  const [draft, setDraft] = useState(filters);

  const query = useMemo<AdminFileListQuery>(() => ({
    page,
    pageSize: PAGE_SIZE,
    q: filters.q || undefined,
    status: filters.status as AdminFileListQuery["status"] || undefined,
    fileType: filters.fileType || undefined,
    sourceType: filters.sourceType || undefined,
    userId: filters.userId || undefined,
  }), [filters, page]);

  const { data, loading, error } = useAdminData(
    () => adminApi.listFiles(query),
    [query],
    onUnauthorized,
  );

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }, [draft]);

  return (
    <DetailPageShell title="文件资产" eyebrow="Files">
      <form className="filter-bar" onSubmit={handleSubmit}>
        <input
          placeholder="搜索文件名"
          value={draft.q}
          onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
        />
        <input
          placeholder="User ID"
          value={draft.userId}
          onChange={(event) => setDraft((current) => ({ ...current, userId: event.target.value }))}
        />
        <select
          value={draft.status}
          onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="">全部状态</option>
          <option value="ready">ready</option>
          <option value="pending_upload">pending_upload</option>
        </select>
        <input
          placeholder="fileType"
          value={draft.fileType}
          onChange={(event) => setDraft((current) => ({ ...current, fileType: event.target.value }))}
        />
        <input
          placeholder="sourceType"
          value={draft.sourceType}
          onChange={(event) => setDraft((current) => ({ ...current, sourceType: event.target.value }))}
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
                  <th>File ID</th>
                  <th>名称</th>
                  <th>类型</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>大小</th>
                  <th>User</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((file) => (
                  <tr key={file.fileId}>
                    <td><EntityLink label={compactId(file.fileId)} hash={fileHash(file.fileId)} onNavigate={navigation.navigate} /></td>
                    <td>
                      <div className="strong-text">{file.displayName}</div>
                      <div className="muted">{file.originalName}</div>
                    </td>
                    <td>{file.fileType}</td>
                    <td>{file.sourceType}</td>
                    <td><StatusBadge value={file.status} /></td>
                    <td>{formatBytes(file.size)}</td>
                    <td className="mono">{compactId(file.userId)}</td>
                    <td>{formatDateTime(file.createdAt)}</td>
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
