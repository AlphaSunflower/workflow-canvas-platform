import assert from "node:assert/strict";
import test from "node:test";

import type {
  WorkflowDetailResponseData,
  WorkflowGroupSummaryItem,
} from "@newworkflow/backend-shared/api";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import { WorkflowAccessPolicy } from "./workflow-access.policy.ts";

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

function createWorkflowDetail(ownerUserId: string): WorkflowDetailResponseData {
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

function createGroup(ownerUserId: string): WorkflowGroupSummaryItem {
  return {
    groupId: "group-1",
    ownerUserId,
    name: "Group 1",
    workflowCount: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

test("WorkflowAccessPolicy allows admin to read non-owned workflow", () => {
  const policy = new WorkflowAccessPolicy();

  assert.equal(
    policy.canAccessWorkflow(createAuthenticatedAccount("admin-user", "admin"), "owner-user"),
    true,
  );
});

test("WorkflowAccessPolicy blocks non-owner from managing workflow", () => {
  const policy = new WorkflowAccessPolicy();

  assert.throws(
    () => policy.assertCanManageWorkflowDetail(
      createAuthenticatedAccount("member-user"),
      createWorkflowDetail("owner-user"),
    ),
    /WORKFLOW_ACCESS_FORBIDDEN/,
  );
});

test("WorkflowAccessPolicy rejects missing group and foreign group access", () => {
  const policy = new WorkflowAccessPolicy();
  const actor = createAuthenticatedAccount("member-user");

  assert.throws(
    () => policy.assertCanAccessGroup(actor, null),
    /WORKFLOW_GROUP_NOT_FOUND/,
  );
  assert.throws(
    () => policy.assertCanAccessGroup(actor, createGroup("other-user")),
    /WORKFLOW_ACCESS_FORBIDDEN/,
  );
});
