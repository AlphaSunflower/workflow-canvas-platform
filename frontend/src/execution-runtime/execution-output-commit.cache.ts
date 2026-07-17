import type {
  ExecutionOutputCommitCacheEntry,
  ExecutionOutputCommitRunCacheRecord,
} from './execution-output-commit.types';

function toWorkflowKey(workflowId?: string | null): string {
  return workflowId ?? '__global__';
}

function toRunKey(runId: string, workflowId?: string | null): string {
  return `${toWorkflowKey(workflowId)}::${runId}`;
}

export function buildExecutionOutputCommitFingerprint(input: {
  runId: string;
  taskId: string;
  groupId?: string | null;
  resultFileId: string;
}): string {
  return [
    input.runId,
    input.taskId,
    input.groupId ?? '__single__',
    input.resultFileId,
  ].join('::');
}

export class ExecutionOutputCommitCache {
  private readonly runs = new Map<string, ExecutionOutputCommitRunCacheRecord>();

  getRun(runId: string, workflowId?: string | null): ExecutionOutputCommitRunCacheRecord | null {
    return this.runs.get(toRunKey(runId, workflowId)) ?? null;
  }

  hasFingerprint(runId: string, fingerprint: string, workflowId?: string | null): boolean {
    return this.getRun(runId, workflowId)?.itemsByFingerprint.has(fingerprint) ?? false;
  }

  getByFingerprint(runId: string, fingerprint: string, workflowId?: string | null): ExecutionOutputCommitCacheEntry | null {
    return this.getRun(runId, workflowId)?.itemsByFingerprint.get(fingerprint) ?? null;
  }

  register(entry: ExecutionOutputCommitCacheEntry): void {
    const key = toRunKey(entry.runId, entry.workflowId);
    const current = this.runs.get(key) ?? {
      runId: entry.runId,
      nodeId: entry.nodeId,
      workflowId: entry.workflowId ?? null,
      itemsByFingerprint: new Map<string, ExecutionOutputCommitCacheEntry>(),
    };

    current.itemsByFingerprint.set(entry.fingerprint, entry);
    this.runs.set(key, current);
  }

  resetRun(runId: string, workflowId?: string | null): void {
    this.runs.delete(toRunKey(runId, workflowId));
  }

  resetWorkflow(workflowId?: string | null): void {
    const keyPrefix = `${toWorkflowKey(workflowId)}::`;
    Array.from(this.runs.keys())
      .filter((key) => key.startsWith(keyPrefix))
      .forEach((key) => {
        this.runs.delete(key);
      });
  }

  reset(): void {
    this.runs.clear();
  }
}

let globalExecutionOutputCommitCache: ExecutionOutputCommitCache | null = null;

export function createExecutionOutputCommitCache(): ExecutionOutputCommitCache {
  return new ExecutionOutputCommitCache();
}

export function getExecutionOutputCommitCache(): ExecutionOutputCommitCache {
  if (!globalExecutionOutputCommitCache) {
    globalExecutionOutputCommitCache = createExecutionOutputCommitCache();
  }

  return globalExecutionOutputCommitCache;
}

export function setExecutionOutputCommitCache(cache: ExecutionOutputCommitCache): void {
  globalExecutionOutputCommitCache = cache;
}

export const executionOutputCommitCache = getExecutionOutputCommitCache();
