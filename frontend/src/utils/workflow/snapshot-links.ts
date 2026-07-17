import type { Workflow, WorkflowRelatedTaskRef } from '@/types';

function dedupeRelatedTasks(tasks: WorkflowRelatedTaskRef[]): WorkflowRelatedTaskRef[] {
  const taskMap = new Map<string, WorkflowRelatedTaskRef>();

  tasks.forEach((task) => {
    taskMap.set(task.taskId, task);
  });

  return Array.from(taskMap.values());
}

export function normalizeWorkflowRelatedTasks(tasks: WorkflowRelatedTaskRef[]): WorkflowRelatedTaskRef[] {
  return dedupeRelatedTasks(tasks).sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
}

export function collectWorkflowRelatedTaskIds(workflow: Workflow): string[] {
  return normalizeWorkflowRelatedTasks(workflow.metadata.relatedTasks ?? []).map((task) => task.taskId);
}
