function dedupeRelatedTasks(tasks) {
    var taskMap = new Map();
    tasks.forEach(function (task) {
        taskMap.set(task.taskId, task);
    });
    return Array.from(taskMap.values());
}
export function normalizeWorkflowRelatedTasks(tasks) {
    return dedupeRelatedTasks(tasks).sort(function (left, right) { var _a, _b; return ((_a = right.createdAt) !== null && _a !== void 0 ? _a : 0) - ((_b = left.createdAt) !== null && _b !== void 0 ? _b : 0); });
}
export function collectWorkflowRelatedTaskIds(workflow) {
    var _a;
    return normalizeWorkflowRelatedTasks((_a = workflow.metadata.relatedTasks) !== null && _a !== void 0 ? _a : []).map(function (task) { return task.taskId; });
}
