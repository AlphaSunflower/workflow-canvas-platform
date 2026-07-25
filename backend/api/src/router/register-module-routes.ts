import type { ApiDependencies } from "../composition/api-dependencies.types.ts";
import type { RouteDefinition } from "./route-types.ts";

export function registerModuleRoutes(
  controllers: ApiDependencies["controllers"],
): RouteDefinition[] {
  return [
    {
      method: "POST",
      pattern: "/api/v1/auth/register",
      handler: ({ request, response }) => controllers.authController.register(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/auth/login",
      handler: ({ request, response }) => controllers.authController.login(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/auth/refresh",
      handler: ({ request, response }) => controllers.authController.refresh(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/auth/logout",
      handler: ({ request, response }) => controllers.authController.logout(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/auth/me",
      handler: ({ request, response }) => controllers.authController.me(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/users/me",
      handler: ({ request, response }) => controllers.usersController.getCurrentUser(request, response),
    },
    {
      method: "PUT",
      pattern: "/api/v1/users/me",
      handler: ({ request, response }) => controllers.usersController.updateCurrentUser(request, response),
    },
    {
      method: "PUT",
      pattern: "/api/v1/users/me/password",
      handler: ({ request, response }) => controllers.usersController.updateCurrentUserPassword(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/users",
      handler: ({ request, response }) => controllers.usersController.listUsers(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/read/users",
      handler: ({ request, response, requestUrl }) =>
        controllers.adminController.listUsers(request, response, requestUrl),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/overview",
      handler: ({ request, response }) =>
        controllers.adminController.getOverview(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/files",
      handler: ({ request, response, requestUrl }) =>
        controllers.adminController.listFiles(request, response, requestUrl),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/files/:fileId",
      handler: ({ request, response, params }) =>
        controllers.adminController.getFileUsage(request, response, params.fileId),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/executions",
      handler: ({ request, response, requestUrl }) =>
        controllers.adminController.listExecutions(request, response, requestUrl),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/executions/:runId",
      handler: ({ request, response, params }) =>
        controllers.adminController.getExecutionDetail(request, response, params.runId),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/workflows",
      handler: ({ request, response, requestUrl }) =>
        controllers.adminController.listWorkflows(request, response, requestUrl),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/workflows/:workflowId",
      handler: ({ request, response, params }) =>
        controllers.adminController.getWorkflowDetail(request, response, params.workflowId),
    },
    {
      method: "GET",
      pattern: "/api/v1/admin/storage/issues",
      handler: ({ request, response, requestUrl }) =>
        controllers.adminController.listStorageIssues(request, response, requestUrl),
    },
    {
      method: "POST",
      pattern: "/api/v1/admin/users",
      handler: ({ request, response }) => controllers.usersController.createUser(request, response),
    },
    {
      method: "PUT",
      pattern: "/api/v1/admin/users/:userId/status",
      handler: ({ request, response, params }) =>
        controllers.usersController.updateUserStatus(request, response, params.userId),
    },
    {
      method: "PUT",
      pattern: "/api/v1/admin/users/:userId/password",
      handler: ({ request, response, params }) =>
        controllers.usersController.resetUserPassword(request, response, params.userId),
    },
    {
      method: "POST",
      pattern: "/api/v1/auth/storyboard-login",
      handler: ({ request, response }) =>
        controllers.authController.storyboardLogin(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/ai/prompt-optimize",
      handler: ({ request, response }) =>
        controllers.promptOptimizeController.optimizePrompt(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/ai/storyboard-arrange",
      handler: ({ request, response }) =>
        controllers.storyboardArrangeController.arrangeStoryboard(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/ai/storyboard-arrange-story",
      handler: ({ request, response }) =>
        controllers.storyboardArrangeController.arrangeStoryboardFromStory(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/files/register",
      handler: ({ request, response }) => controllers.filesController.register(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/files/upload",
      handler: ({ request, response }) => controllers.filesController.upload(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/files/:fileId",
      handler: ({ request, response, params }) =>
        controllers.filesController.getFile(request, params.fileId, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/files/:fileId/download",
      handler: ({ request, response, params }) =>
        controllers.filesController.download(request, params.fileId, "download", response),
    },
    {
      method: "GET",
      pattern: "/api/v1/files/:fileId/preview",
      handler: ({ request, response, params }) =>
        controllers.filesController.download(request, params.fileId, "preview", response),
    },
    {
      method: "GET",
      pattern: "/api/v1/files/:fileId/thumbnail",
      handler: ({ request, response, params }) =>
        controllers.filesController.download(request, params.fileId, "thumbnail", response),
    },
    {
      method: "GET",
      pattern: "/api/v1/workflows/manage",
      handler: ({ request, response }) => controllers.workflowsController.listManaged(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/workflows/blank",
      handler: ({ request, response }) => controllers.workflowsController.createBlank(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/workflows/groups",
      handler: ({ request, response }) =>
        controllers.workflowsController.createGroup(request, response),
    },
    {
      method: "PATCH",
      pattern: "/api/v1/workflows/groups/:groupId",
      handler: ({ request, response, params }) =>
        controllers.workflowsController.renameGroup(request, response, params.groupId),
    },
    {
      method: "DELETE",
      pattern: "/api/v1/workflows/groups/:groupId",
      handler: ({ request, response, params }) =>
        controllers.workflowsController.deleteGroup(request, response, params.groupId),
    },
    {
      method: "GET",
      pattern: "/api/v1/workflows",
      handler: ({ request, response }) => controllers.workflowsController.list(request, response),
    },
    {
      method: "POST",
      pattern: "/api/v1/workflows",
      handler: ({ request, response }) => controllers.workflowsController.create(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/workflows/:workflowId",
      handler: ({ request, response, params }) =>
        controllers.workflowsController.get(request, response, params.workflowId),
    },
    {
      method: "PUT",
      pattern: "/api/v1/workflows/:workflowId",
      handler: ({ request, response, params }) =>
        controllers.workflowsController.update(request, response, params.workflowId),
    },
    {
      method: "DELETE",
      pattern: "/api/v1/workflows/:workflowId",
      handler: ({ request, response, params }) =>
        controllers.workflowsController.delete(request, response, params.workflowId),
    },
    {
      method: "PATCH",
      pattern: "/api/v1/workflows/:workflowId/name",
      handler: ({ request, response, params }) =>
        controllers.workflowsController.rename(request, response, params.workflowId),
    },
    {
      method: "PATCH",
      pattern: "/api/v1/workflows/:workflowId/group",
      handler: ({ request, response, params }) =>
        controllers.workflowsController.moveGroup(request, response, params.workflowId),
    },
    {
      method: "POST",
      pattern: "/api/v1/executions",
      handler: ({ request, response }) => controllers.executionsController.createExecution(request, response),
    },
    {
      method: "GET",
      pattern: "/api/v1/executions/:runId",
      handler: ({ request, response, requestUrl, params }) =>
        controllers.executionQueryController.getExecutionRun(request, response, requestUrl, params.runId),
    },
    {
      method: "GET",
      pattern: "/api/v1/tasks",
      handler: ({ request, response, requestUrl }) =>
        controllers.executionQueryController.listTasks(request, response, requestUrl),
    },
    {
      method: "GET",
      pattern: "/api/v1/tasks/:taskId",
      handler: ({ request, response, requestUrl, params }) =>
        controllers.executionQueryController.getTask(request, response, requestUrl, params.taskId),
    },
    {
      method: "GET",
      pattern: "/api/v1/tasks/:taskId/events",
      handler: ({ request, response, requestUrl, params }) =>
        controllers.executionQueryController.getTaskEvents(request, response, requestUrl, params.taskId),
    },
    {
      method: "GET",
      pattern: "/api/v1/workflows/:workflowId/executions/reconcile",
      handler: ({ request, response, requestUrl, params }) =>
        controllers.executionQueryController.handleWorkflowExecutionReconcile(
          request,
          response,
          requestUrl,
          params.workflowId,
        ),
    },
    {
      method: "GET",
      pattern: "/api/v1/workflows/:workflowId/tasks",
      handler: ({ request, response, requestUrl, params }) =>
        controllers.executionQueryController.listWorkflowTasks(
          request,
          response,
          requestUrl,
          params.workflowId,
        ),
    },
    {
      method: "GET",
      pattern: "/api/v1/workflows/:workflowId/tasks/:taskId",
      handler: ({ request, response, requestUrl, params }) =>
        controllers.executionQueryController.getWorkflowTask(
          request,
          response,
          requestUrl,
          params.workflowId,
          params.taskId,
        ),
    },
    {
      method: "GET",
      pattern: "/api/v1/workflows/:workflowId/tasks/:taskId/events",
      handler: ({ request, response, requestUrl, params }) =>
        controllers.executionQueryController.getWorkflowTaskEvents(
          request,
          response,
          requestUrl,
          params.workflowId,
          params.taskId,
        ),
    },
  ];
}
