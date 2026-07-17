import { adminApi } from "../api/admin-api.ts";
import type { AppNavigation } from "../App.tsx";
import { DataState } from "../components/DataState.tsx";
import { DetailPageShell } from "../components/DetailPageShell.tsx";
import { EntityLink } from "../components/EntityLink.tsx";
import { InfoGrid } from "../components/InfoGrid.tsx";
import { JsonBlock } from "../components/JsonBlock.tsx";
import { StatusBadge } from "../components/StatusBadge.tsx";
import { compactId, fileHash, formatDateTime, workflowHash } from "../components/format.ts";
import { useAdminData } from "../components/useAdminData.ts";

interface ExecutionDetailPageProps {
  runId: string;
  navigation: AppNavigation;
  onUnauthorized: () => void;
}

export function ExecutionDetailPage({
  runId,
  navigation,
  onUnauthorized,
}: ExecutionDetailPageProps): JSX.Element {
  const { data, loading, error } = useAdminData(
    () => adminApi.getExecution(runId),
    [runId],
    onUnauthorized,
  );

  return (
    <DetailPageShell
      title="执行详情"
      eyebrow={runId}
      actions={<button className="secondary-button" type="button" onClick={() => navigation.navigate("#/executions")}>返回列表</button>}
    >
      <DataState loading={loading} error={error} />
      {data ? (
        <div className="detail-stack">
          <section className="panel-section">
            <h2>Run 信息</h2>
            <InfoGrid
              items={[
                { label: "Run ID", value: <span className="mono">{data.runId}</span> },
                { label: "Run No", value: data.runNo },
                { label: "状态", value: <StatusBadge value={data.status} /> },
                { label: "Workflow", value: <EntityLink label={compactId(data.workflowId)} hash={data.workflowId ? workflowHash(data.workflowId) : null} onNavigate={navigation.navigate} /> },
                { label: "User ID", value: <span className="mono">{data.userId ?? "-"}</span> },
                { label: "Project ID", value: <span className="mono">{data.projectId ?? "-"}</span> },
                { label: "Node", value: data.nodeType },
                { label: "Task", value: data.taskType },
                { label: "Execution Mode", value: data.executionMode },
                { label: "Provider", value: data.provider ?? "-" },
                { label: "任务数", value: `${data.completedTaskCount}/${data.totalTaskCount} completed, ${data.failedTaskCount} failed` },
                { label: "创建时间", value: formatDateTime(data.createdAt) },
                { label: "开始时间", value: formatDateTime(data.startedAt) },
                { label: "完成时间", value: formatDateTime(data.completedAt) },
              ]}
            />
          </section>

          <section className="panel-section">
            <h2>输入文件</h2>
            <DataState empty={data.inputFiles.length === 0} />
            <FileStrip files={data.inputFiles} navigation={navigation} />
          </section>

          <section className="panel-section">
            <h2>输出文件</h2>
            <DataState empty={data.outputFiles.length === 0} />
            <FileStrip files={data.outputFiles} navigation={navigation} />
          </section>

          <section className="panel-section">
            <h2>任务</h2>
            <DataState empty={data.tasks.length === 0} />
            {data.tasks.length > 0 ? (
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Node</th>
                      <th>状态</th>
                      <th>当前步骤</th>
                      <th>结果文件</th>
                      <th>错误</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((task) => (
                      <tr key={task.taskId}>
                        <td>
                          <div className="strong-text mono">{task.taskNo}</div>
                          <div className="muted mono">{compactId(task.taskId)}</div>
                        </td>
                        <td>
                          <div className="strong-text">{task.nodeTitle ?? task.nodeType}</div>
                          <div className="muted">{task.taskType}</div>
                        </td>
                        <td><StatusBadge value={task.status} /></td>
                        <td>{task.currentStep ?? "-"}</td>
                        <td><EntityLink label={compactId(task.resultFileId)} hash={task.resultFileId ? fileHash(task.resultFileId) : null} onNavigate={navigation.navigate} /></td>
                        <td>{task.lastErrorMessage ?? task.lastErrorCode ?? "-"}</td>
                        <td>
                          <div>{formatDateTime(task.createdAt)}</div>
                          <div className="muted">{formatDateTime(task.completedAt)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="panel-section">
            <h2>任务输入快照</h2>
            <JsonBlock value={data.tasks.map((task) => ({
              taskId: task.taskId,
              input: task.input,
              inputFileId: task.inputFileId,
              sourceFileId: task.sourceFileId,
              referenceFileIds: task.referenceFileIds,
            }))} />
          </section>
        </div>
      ) : null}
    </DetailPageShell>
  );
}

function FileStrip({
  files,
  navigation,
}: {
  files: NonNullable<Awaited<ReturnType<typeof adminApi.getExecution>>>["inputFiles"];
  navigation: AppNavigation;
}): JSX.Element | null {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="file-strip">
      {files.map((file) => (
        <button
          key={file.fileId}
          className="file-chip"
          type="button"
          onClick={() => navigation.navigate(fileHash(file.fileId))}
        >
          <span>{file.displayName}</span>
          <small>{file.fileType} / {compactId(file.fileId)}</small>
        </button>
      ))}
    </div>
  );
}
