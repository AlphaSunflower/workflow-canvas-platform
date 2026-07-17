import { adminApi } from "../api/admin-api.ts";
import type { AppNavigation } from "../App.tsx";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { InfoGrid } from "../components/InfoGrid.tsx";
import { JsonBlock } from "../components/JsonBlock.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { compactId, executionHash, fileHash, formatDateTime } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface WorkflowDetailPageProps {
  workflowId: string;
  navigation: AppNavigation;
  onUnauthorized: () => void;
}

export function WorkflowDetailPage({
  workflowId,
  navigation,
  onUnauthorized,
}: WorkflowDetailPageProps): JSX.Element {
  const { data, loading, error } = useAdminData(
    () => adminApi.getWorkflow(workflowId),
    [workflowId],
    onUnauthorized,
  );

  return (
    <DetailPageShell
      title="Workflow 详情"
      eyebrow={workflowId}
      actions={<button className="secondary-button" type="button" onClick={() => navigation.navigate("#/workflows")}>返回列表</button>}
    >
      <DataState loading={loading} error={error} />
      {data ? (
        <div className="detail-stack">
          <section className="panel-section">
            <h2>基础信息</h2>
            <InfoGrid
              items={[
                { label: "Workflow ID", value: <span className="mono">{data.workflowId}</span> },
                { label: "名称", value: data.workflow.name },
                { label: "Owner", value: <span className="mono">{data.ownerUserId}</span> },
                { label: "Group", value: <span className="mono">{data.groupId ?? "-"}</span> },
                { label: "Project", value: data.workflow.projectId },
                { label: "Container", value: data.containerKey },
                { label: "版本", value: data.workflow.version ?? "-" },
                { label: "节点数", value: Object.keys(data.workflow.nodes ?? {}).length },
                { label: "连线数", value: data.workflow.connections.length },
                { label: "创建时间", value: formatDateTime(data.createdAt) },
                { label: "更新时间", value: formatDateTime(data.updatedAt) },
              ]}
            />
          </section>

          <section className="panel-section">
            <h2>绑定文件</h2>
            <DataState empty={data.files.length === 0} />
            {data.files.length > 0 ? (
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>名称</th>
                      <th>类型</th>
                      <th>来源</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.files.map((file) => (
                      <tr key={file.fileId}>
                        <td><EntityLink label={compactId(file.fileId)} hash={fileHash(file.fileId)} onNavigate={navigation.navigate} /></td>
                        <td>{file.displayName}</td>
                        <td>{file.fileType}</td>
                        <td>{file.sourceType}</td>
                        <td><StatusBadge value={file.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="panel-section">
            <h2>相关任务</h2>
            <DataState empty={data.tasks.length === 0} />
            {data.tasks.length > 0 ? (
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Task</th>
                      <th>Node</th>
                      <th>状态</th>
                      <th>结果文件</th>
                      <th>完成时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((task) => (
                      <tr key={task.taskId}>
                        <td><EntityLink label={task.runNo ?? compactId(task.runId)} hash={executionHash(task.runId)} onNavigate={navigation.navigate} /></td>
                        <td className="mono">{task.taskNo}</td>
                        <td>{task.nodeTitle ?? task.nodeType}</td>
                        <td><StatusBadge value={task.status} /></td>
                        <td><EntityLink label={compactId(task.resultFileId)} hash={task.resultFileId ? fileHash(task.resultFileId) : null} onNavigate={navigation.navigate} /></td>
                        <td>{formatDateTime(task.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="panel-section">
            <h2>Workflow Payload</h2>
            <JsonBlock value={data.workflow} />
          </section>
        </div>
      ) : null}
    </DetailPageShell>
  );
}
