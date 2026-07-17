import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import { FilesRepository } from "../files/files.repository.ts";
import { WorkflowGroupsRepository } from "./workflow-groups.repository.ts";
import { WorkflowRepository } from "./workflow.repository.ts";
import { WorkflowFilesRepository } from "./workflow-files.repository.ts";
import { WorkflowsService } from "./workflows.service.ts";

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
      lastLoginAt: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2026-04-01T00:00:00.000Z").toISOString(),
    },
    accessTokenPayload: {
      userId,
      role,
      status: "enabled",
    },
  };
}

function createService(rootDir: string): WorkflowsService {
  return new WorkflowsService(
    new WorkflowRepository(rootDir),
    new WorkflowGroupsRepository(rootDir),
    new WorkflowFilesRepository(rootDir),
    new FilesRepository(rootDir),
  );
}

async function createWorkflow(
  service: WorkflowsService,
  authenticated: AuthenticatedAccount,
  input: {
    projectId?: string;
    name?: string;
    groupId?: string | null;
  } = {},
) {
  return service.createBlankWorkflowForActor(authenticated, {
    projectId: input.projectId ?? "project-default",
    name: input.name,
    groupId: input.groupId ?? null,
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {},
    timestamp: Date.now(),
  });
}

test("WorkflowsService listManagedWorkflowsForActor isolates workflow lists by account", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-service-"));
  const service = createService(rootDir);
  const userA = createAuthenticatedAccount("user-a");
  const userB = createAuthenticatedAccount("user-b");

  try {
    await createWorkflow(service, userA, { name: "Canvas A" });
    await createWorkflow(service, userB, { name: "Canvas B" });

    const userAList = await service.listManagedWorkflowsForActor(userA);
    const userBList = await service.listManagedWorkflowsForActor(userB);

    assert.deepEqual(userAList.items.map((item) => item.ownerUserId), ["user-a"]);
    assert.deepEqual(userAList.items.map((item) => item.name), ["Canvas A"]);
    assert.deepEqual(userBList.items.map((item) => item.ownerUserId), ["user-b"]);
    assert.deepEqual(userBList.items.map((item) => item.name), ["Canvas B"]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("WorkflowsService deleteGroupForActor moves grouped workflows back to ungrouped and resolves name conflicts", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-service-"));
  const service = createService(rootDir);
  const user = createAuthenticatedAccount("user-group");

  try {
    const group = await service.createGroupForActor(user, { name: "Group 1" });
    await createWorkflow(service, user, { name: "Canvas", groupId: null });
    const grouped = await createWorkflow(service, user, { name: "Canvas", groupId: group.groupId });

    const result = await service.deleteGroupForActor(user, group.groupId);
    const list = await service.listManagedWorkflowsForActor(user);
    const moved = list.items.find((item) => item.workflowId === grouped.workflowId);

    assert.equal(result.deleted, true);
    assert.equal(result.movedWorkflowCount, 1);
    assert.equal(moved?.groupId, null);
    assert.equal(moved?.containerKey, "__ungrouped__");
    assert.equal(moved?.name, "Canvas (2)");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("WorkflowsService creates duplicate names with Windows-like suffixes inside the same container", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-service-"));
  const service = createService(rootDir);
  const user = createAuthenticatedAccount("user-name");

  try {
    const first = await createWorkflow(service, user, { name: "Canvas" });
    const second = await createWorkflow(service, user, { name: "Canvas" });

    assert.equal(first.workflow.name, "Canvas");
    assert.equal(second.workflow.name, "Canvas (2)");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("WorkflowsService moveWorkflowGroupForActor resolves duplicate names in target container", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-service-"));
  const service = createService(rootDir);
  const user = createAuthenticatedAccount("user-move");

  try {
    const group = await service.createGroupForActor(user, { name: "Target Group" });
    await createWorkflow(service, user, { name: "Canvas", groupId: group.groupId });
    const ungrouped = await createWorkflow(service, user, { name: "Canvas", groupId: null });

    const moved = await service.moveWorkflowGroupForActor(user, ungrouped.workflowId, {
      groupId: group.groupId,
    });

    assert.equal(moved.groupId, group.groupId);
    assert.equal(moved.containerKey, group.groupId);
    assert.equal(moved.workflow.name, "Canvas (2)");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
