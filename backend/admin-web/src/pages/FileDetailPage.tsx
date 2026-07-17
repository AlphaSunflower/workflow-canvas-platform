import { adminApi } from "../api/admin-api.ts";
import type { AppNavigation } from "../App.tsx";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { InfoGrid } from "../components/InfoGrid.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { compactId, executionHash, formatBytes, formatDateTime, workflowHash } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface FileDetailPageProps {
  fileId: string;
  navigation: AppNavigation;
  onUnauthorized: () => void;
}

export function FileDetailPage({
  fileId,
  navigation,
  onUnauthorized,
}: FileDetailPageProps): JSX.Element {
  const { data, loading, error } = useAdminData(
    () => adminApi.getFile(fileId),
    [fileId],
    onUnauthorized,
  );

  return (
    <DetailPageShell
      title="文件详情"
      eyebrow={fileId}
      actions={<button className="secondary-button" type="button" onClick={() => navigation.navigate("#/files")}>返回列表</button>}
    >
      <DataState loading={loading} error={error} />
      {data ? (
        <div className="detail-stack">
          <section className="panel-section">
            <h2>基础信息</h2>
            <InfoGrid
              items={[
                { label: "File ID", value: <span className="mono">{data.file.fileId}</span> },
                { label: "Blob ID", value: <span className="mono">{data.file.blobId ?? "-"}</span> },
                { label: "状态", value: <StatusBadge value={data.file.status} /> },
                { label: "名称", value: data.file.displayName },
                { label: "原始名", value: data.file.originalName },
                { label: "MIME", value: data.file.mimeType },
                { label: "文件类型", value: data.file.fileType },
                { label: "来源类型", value: data.file.sourceType },
                { label: "大小", value: formatBytes(data.file.size) },
                { label: "尺寸", value: data.file.width && data.file.height ? `${data.file.width} x ${data.file.height}` : "-" },
                { label: "User ID", value: <span className="mono">{data.file.userId ?? "-"}</span> },
                { label: "SHA256", value: <span className="mono wrap">{data.file.sha256 ?? "-"}</span> },
                { label: "创建时间", value: formatDateTime(data.file.createdAt) },
              ]}
            />
            <div className="inline-actions">
              {data.file.downloadUrl ? <a className="secondary-button" href={data.file.downloadUrl} target="_blank" rel="noreferrer">下载</a> : null}
              {data.file.previewUrl ? <a className="secondary-button" href={data.file.previewUrl} target="_blank" rel="noreferrer">预览</a> : null}
              {data.file.thumbnailUrl ? <a className="secondary-button" href={data.file.thumbnailUrl} target="_blank" rel="noreferrer">缩略图</a> : null}
            </div>
          </section>

          <section className="panel-section">
            <h2>Workflow 使用链路</h2>
            <DataState empty={data.workflows.length === 0} />
            {data.workflows.length > 0 ? (
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>Workflow</th>
                      <th>名称</th>
                      <th>Owner</th>
                      <th>Node</th>
                      <th>角色</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workflows.map((item) => (
                      <tr key={`${item.workflowId}:${item.nodeId}:${item.role}`}>
                        <td><EntityLink label={compactId(item.workflowId)} hash={workflowHash(item.workflowId)} onNavigate={navigation.navigate} /></td>
                        <td>{item.workflowName ?? "-"}</td>
                        <td className="mono">{compactId(item.ownerUserId)}</td>
                        <td className="mono">{compactId(item.nodeId)}</td>
                        <td>{item.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="panel-section">
            <h2>任务使用链路</h2>
            <DataState empty={data.tasks.length === 0} />
            {data.tasks.length > 0 ? (
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Task</th>
                      <th>Workflow</th>
                      <th>Node</th>
                      <th>角色</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((item) => (
                      <tr key={`${item.taskId}:${item.role}`}>
                        <td><EntityLink label={item.runNo ?? compactId(item.runId)} hash={item.runId ? executionHash(item.runId) : null} onNavigate={navigation.navigate} /></td>
                        <td className="mono">{item.taskNo ?? compactId(item.taskId)}</td>
                        <td><EntityLink label={compactId(item.workflowId)} hash={item.workflowId ? workflowHash(item.workflowId) : null} onNavigate={navigation.navigate} /></td>
                        <td>{item.nodeType ?? "-"}</td>
                        <td>{item.role}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </DetailPageShell>
  );
}
