import assert from "node:assert/strict";
import test from "node:test";

import type {
  FileAssetResponse,
  WorkflowDetailResponseData,
} from "@newworkflow/backend-shared/api";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import { ExecutionAccessPolicy } from "./execution-access.policy.ts";

function createAuthenticatedAccount(
  userId: string,
  role: "admin" | "member" = "member",
): AuthenticatedAccount {
  return {
    user: {
      userId,
      email: `${userId}@example.com`,
      displayName: userId,
      role,
      status: "enabled",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      lastLoginAt: null,
    },
    accessTokenPayload: {
      userId,
      role,
      status: "enabled",
    },
  };
}

function createFile(fileId: string, userId: string): FileAssetResponse {
  return {
    fileId,
    userId,
    blobId: null,
    originalName: "file.png",
    displayName: "file.png",
    mimeType: "image/png",
    fileType: "image",
    sourceType: "input",
    sha256: null,
    size: 1,
    extension: "png",
    width: null,
    height: null,
    duration: null,
    status: "ready",
    createdAt: new Date(0).toISOString(),
  };
}

function createWorkflow(ownerUserId: string): WorkflowDetailResponseData {
  return {
    workflowId: "workflow-1",
    ownerUserId,
    groupId: null,
    containerKey: "__ungrouped__",
    isAutoNamed: false,
    workflow: {
      id: "workflow-1",
      projectId: "project-1",
      name: "Workflow 1",
      nodes: {},
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {},
      timestamp: Date.now(),
      version: 1,
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

test("ExecutionAccessPolicy validates workflowId and member file ownership", () => {
  const policy = new ExecutionAccessPolicy();

  assert.equal(policy.assertWorkflowId(" workflow-1 "), "workflow-1");
  assert.throws(() => policy.assertWorkflowId(" "), /INVALID_WORKFLOW_ID/);
  assert.throws(
    () => policy.assertFilesAccessible(
      createAuthenticatedAccount("user-1"),
      [createFile("file-1", "user-2")],
    ),
    /FILE_ACCESS_FORBIDDEN/,
  );
});

test("ExecutionAccessPolicy allows admin and blocks foreign workflow for member", () => {
  const policy = new ExecutionAccessPolicy();

  assert.equal(
    policy.assertWorkflowAccessible(
      createAuthenticatedAccount("admin-1", "admin"),
      createWorkflow("owner-1"),
    ).workflowId,
    "workflow-1",
  );
  assert.throws(
    () => policy.assertWorkflowAccessible(
      createAuthenticatedAccount("member-1"),
      createWorkflow("owner-1"),
    ),
    /WORKFLOW_ACCESS_FORBIDDEN/,
  );
});
