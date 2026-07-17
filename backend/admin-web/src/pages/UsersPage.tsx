import { FormEvent, useCallback, useMemo, useState } from "react";
import { adminApi, type AdminUserListQuery } from "../api/admin-api.ts";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { Pagination } from "../components/Pagination.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { compactId, formatDateTime } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface UsersPageProps {
  onUnauthorized: () => void;
}

const PAGE_SIZE = 20;

export function UsersPage({ onUnauthorized }: UsersPageProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    q: "",
    role: "",
    status: "",
  });
  const [draft, setDraft] = useState(filters);

  const query = useMemo<AdminUserListQuery>(() => ({
    page,
    pageSize: PAGE_SIZE,
    q: filters.q || undefined,
    role: filters.role as AdminUserListQuery["role"] || undefined,
    status: filters.status as AdminUserListQuery["status"] || undefined,
  }), [filters, page]);

  const { data, loading, error } = useAdminData(
    () => adminApi.listUsers(query),
    [query],
    onUnauthorized,
  );

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setFilters(draft);
  }, [draft]);

  return (
    <DetailPageShell title="用户" eyebrow="Users">
      <form className="filter-bar" onSubmit={handleSubmit}>
        <input
          placeholder="搜索邮箱/名称"
          value={draft.q}
          onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
        />
        <select
          value={draft.role}
          onChange={(event) => setDraft((current) => ({ ...current, role: event.target.value }))}
        >
          <option value="">全部角色</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
        </select>
        <select
          value={draft.status}
          onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
        >
          <option value="">全部状态</option>
          <option value="enabled">enabled</option>
          <option value="disabled">disabled</option>
        </select>
        <button className="secondary-button" type="submit">筛选</button>
      </form>
      <DataState loading={loading} error={error} empty={Boolean(data && data.items.length === 0)} />
      {data ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>账号</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>上次登录</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.userId}>
                    <td className="mono">{compactId(user.userId)}</td>
                    <td>
                      <div className="strong-text">{user.displayName}</div>
                      <div className="muted">{user.email}</div>
                    </td>
                    <td><StatusBadge value={user.role} /></td>
                    <td><StatusBadge value={user.status} /></td>
                    <td>{formatDateTime(user.lastLoginAt)}</td>
                    <td>{formatDateTime(user.createdAt)}</td>
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
