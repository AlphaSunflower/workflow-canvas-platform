import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  bearer,
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  registerAccount,
  registerAndUploadFile,
  requestJson,
  startDbApi,
} from "./bootstrap-db.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown): Record<string, unknown> {
  assert.equal(isRecord(value), true);
  return value as Record<string, unknown>;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  );
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("workflows_full");
  const api = await startDbApi(context);
  const legacyWorkflowsDir = path.join(context.rootDir, "data", "workflows");
  const workflowId = "workflow-full-e2e";

  try {
    await fs.rm(legacyWorkflowsDir, { recursive: true, force: true });
    assert.equal(await exists(legacyWorkflowsDir), false);

    const owner = await registerAccount(api.baseUrl, {
      email: "workflows-full-owner@example.com",
      password: "workflows-full-owner-pass",
      displayName: "Workflows Full Owner",
    });
    const other = await registerAccount(api.baseUrl, {
      email: "workflows-full-other@example.com",
      password: "workflows-full-other-pass",
      displayName: "Workflows Full Other",
    });
    const sourceFile = await registerAndUploadFile(api.baseUrl, owner.accessToken, {
      originalName: "workflow-hydrate.png",
      displayName: "Hydrated Source",
    });

    const createGroupResponse = await requestJson<{
      groupId: string;
      ownerUserId: string;
      name: string;
      workflowCount: number;
    }>(api.baseUrl, "/api/v1/workflows/groups", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        name: "Group Alpha",
      },
    });
    assert.equal(createGroupResponse.status, 201);
    assert.ok(createGroupResponse.body.data?.groupId);
    assert.equal(createGroupResponse.body.data.ownerUserId, owner.userId);
    assert.equal(createGroupResponse.body.data.name, "Group Alpha");
    const groupId = createGroupResponse.body.data.groupId;

    const createWorkflowResponse = await requestJson<{
      workflowId: string;
      ownerUserId: string;
      groupId: string | null;
      workflow: {
        name: string;
        nodes: Record<string, unknown>;
      };
    }>(api.baseUrl, "/api/v1/workflows/blank", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        id: workflowId,
        projectId: "project-workflows-full",
        name: "DB Full Workflow",
        groupId,
        metadata: {
          createdFrom: "db-only-e2e",
        },
        timestamp: 1770000100000,
      },
    });
    assert.equal(createWorkflowResponse.status, 201);
    assert.equal(createWorkflowResponse.body.data?.workflowId, workflowId);
    assert.equal(createWorkflowResponse.body.data?.ownerUserId, owner.userId);
    assert.equal(createWorkflowResponse.body.data?.groupId, groupId);
    assert.deepEqual(createWorkflowResponse.body.data?.workflow.nodes, {});

    const updateResponse = await requestJson<{
      workflowId: string;
      groupId: string | null;
      workflow: {
        name: string;
        version?: number;
        nodes: Record<string, Record<string, unknown>>;
        metadata: Record<string, unknown>;
      };
    }>(api.baseUrl, `/api/v1/workflows/${workflowId}`, {
      method: "PUT",
      headers: bearer(owner.accessToken),
      payload: {
        projectId: "project-workflows-full",
        name: "DB Full Workflow Saved",
        nodes: {
          "file-node": {
            id: "file-node",
            type: "image",
            fileId: sourceFile.fileId,
            previewUrl: "blob:http://localhost/transient-preview",
            thumbnailUrl: "data:image/png;base64,transient",
            imageAsset: {
              source: "local",
            },
            localState: {
              dirty: true,
            },
          },
          "reference-node": {
            id: "reference-node",
            type: "aiImageGen",
            references: [
              {
                id: "ref-1",
                fileId: sourceFile.fileId,
              },
            ],
          },
          "gallery-node": {
            id: "gallery-node",
            type: "gallery",
            fileIds: [sourceFile.fileId, sourceFile.fileId],
          },
        },
        connections: [
          {
            id: "edge-1",
            sourceId: "file-node",
            targetId: "reference-node",
            references: [
              {
                fileId: sourceFile.fileId,
              },
            ],
          },
        ],
        viewport: {
          x: 12,
          y: 24,
          zoom: 0.8,
        },
        metadata: {
          savedFrom: "db-only-e2e",
        },
        timestamp: 1770000101000,
      },
    });
    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.data?.workflowId, workflowId);
    assert.equal(updateResponse.body.data?.groupId, groupId);
    assert.equal(updateResponse.body.data?.workflow.name, "DB Full Workflow Saved");
    assert.equal(updateResponse.body.data?.workflow.version, 2);
    assert.equal(updateResponse.body.data?.workflow.nodes["file-node"]?.fileName, "Hydrated Source");
    assert.equal(
      updateResponse.body.data?.workflow.nodes["file-node"]?.previewUrl,
      `/api/v1/files/${sourceFile.fileId}/preview`,
    );
    assert.equal(
      updateResponse.body.data?.workflow.nodes["file-node"]?.thumbnailUrl,
      `/api/v1/files/${sourceFile.fileId}/thumbnail`,
    );
    assert.ok(updateResponse.body.data?.workflow.nodes["file-node"]?.imageAsset);

    const workflowRows = await context.pool.query<{
      owner_user_id: string;
      group_id: string | null;
      node_count: number;
      connection_count: number;
      version: number;
      payload: unknown;
    }>(
      `
        select owner_user_id, group_id, node_count, connection_count, version, payload
        from workflows
        where id = $1
      `,
      [workflowId],
    );
    assert.equal(workflowRows.rows.length, 1);
    assert.equal(workflowRows.rows[0]?.owner_user_id, owner.userId);
    assert.equal(workflowRows.rows[0]?.group_id, groupId);
    assert.equal(workflowRows.rows[0]?.node_count, 3);
    assert.equal(workflowRows.rows[0]?.connection_count, 1);
    assert.equal(workflowRows.rows[0]?.version, 2);
    const persistedPayload = requireRecord(workflowRows.rows[0]?.payload);
    assert.equal(persistedPayload.id, workflowId);
    assert.equal(requireRecord(persistedPayload.metadata).savedFrom, "db-only-e2e");

    const bindingRows = await context.pool.query<{
      role: string;
      total: number;
    }>(
      `
        select role, count(*)::int as total
        from workflow_file_bindings
        where workflow_id = $1
        group by role
      `,
      [workflowId],
    );
    const bindingCounts = new Map(bindingRows.rows.map((row) => [row.role, row.total]));
    assert.equal(bindingCounts.get("file-node"), 1);
    assert.equal(bindingCounts.get("node-reference"), 1);
    assert.equal(bindingCounts.get("file-group"), 1);
    assert.equal(bindingCounts.get("connection-reference"), 1);

    const getResponse = await requestJson<{
      workflowId: string;
      groupId: string | null;
      workflow: {
        name: string;
        nodes: Record<string, Record<string, unknown>>;
        metadata: Record<string, unknown>;
      };
    }>(api.baseUrl, `/api/v1/workflows/${workflowId}`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.data?.workflowId, workflowId);
    assert.equal(getResponse.body.data?.groupId, groupId);
    assert.equal(getResponse.body.data?.workflow.metadata.savedFrom, "db-only-e2e");
    assert.equal(getResponse.body.data?.workflow.nodes["file-node"]?.fileId, sourceFile.fileId);
    assert.equal(getResponse.body.data?.workflow.nodes["file-node"]?.fileName, "Hydrated Source");
    assert.equal(getResponse.body.data?.workflow.nodes["file-node"]?.mimeType, "image/png");
    assert.equal(getResponse.body.data?.workflow.nodes["file-node"]?.fileSize, sourceFile.content.length);
    assert.equal(
      getResponse.body.data?.workflow.nodes["file-node"]?.previewUrl,
      `/api/v1/files/${sourceFile.fileId}/preview`,
    );
    assert.equal(
      getResponse.body.data?.workflow.nodes["file-node"]?.thumbnailUrl,
      `/api/v1/files/${sourceFile.fileId}/thumbnail`,
    );
    assert.equal(
      requireRecord(
        requireRecord(getResponse.body.data?.workflow.nodes["file-node"]?.imageAsset).variants,
      ).original instanceof Object,
      true,
    );

    const forbiddenGet = await requestJson(api.baseUrl, `/api/v1/workflows/${workflowId}`, {
      headers: bearer(other.accessToken),
    });
    assert.equal(forbiddenGet.status, 403);

    const renameGroupResponse = await requestJson<{
      groupId: string;
      name: string;
    }>(api.baseUrl, `/api/v1/workflows/groups/${groupId}`, {
      method: "PATCH",
      headers: bearer(owner.accessToken),
      payload: {
        name: "Group Beta",
      },
    });
    assert.equal(renameGroupResponse.status, 200);
    assert.equal(renameGroupResponse.body.data?.groupId, groupId);
    assert.equal(renameGroupResponse.body.data?.name, "Group Beta");

    const managedResponse = await requestJson<{
      items: Array<{
        workflowId: string;
        groupId: string | null;
      }>;
      groups: Array<{
        groupId: string;
        name: string;
        workflowCount: number;
      }>;
      total: number;
    }>(api.baseUrl, "/api/v1/workflows/manage", {
      headers: bearer(owner.accessToken),
    });
    assert.equal(managedResponse.status, 200);
    assert.equal(managedResponse.body.data?.total, 1);
    assert.equal(managedResponse.body.data?.items[0]?.workflowId, workflowId);
    assert.equal(managedResponse.body.data?.items[0]?.groupId, groupId);
    assert.equal(managedResponse.body.data?.groups[0]?.groupId, groupId);
    assert.equal(managedResponse.body.data?.groups[0]?.name, "Group Beta");
    assert.equal(managedResponse.body.data?.groups[0]?.workflowCount, 1);

    const moveResponse = await requestJson<{
      workflowId: string;
      groupId: string | null;
    }>(api.baseUrl, `/api/v1/workflows/${workflowId}/group`, {
      method: "PATCH",
      headers: bearer(owner.accessToken),
      payload: {
        groupId: null,
      },
    });
    assert.equal(moveResponse.status, 200);
    assert.equal(moveResponse.body.data?.groupId, null);

    const groupRows = await context.pool.query<{
      total: number;
      renamed: number;
      grouped_workflows: number;
    }>(
      `
        select
          count(*)::int as total,
          count(*) filter (where name = 'Group Beta')::int as renamed,
          (
            select count(*)::int
            from workflows
            where id = $2
              and group_id is not null
          ) as grouped_workflows
        from workflow_groups
        where id = $1
      `,
      [groupId, workflowId],
    );
    assert.equal(groupRows.rows[0]?.total, 1);
    assert.equal(groupRows.rows[0]?.renamed, 1);
    assert.equal(groupRows.rows[0]?.grouped_workflows, 0);

    const clearBindingsResponse = await requestJson<{
      workflowId: string;
      workflow: {
        nodes: Record<string, unknown>;
      };
    }>(api.baseUrl, `/api/v1/workflows/${workflowId}`, {
      method: "PUT",
      headers: bearer(owner.accessToken),
      payload: {
        projectId: "project-workflows-full",
        name: "DB Full Workflow Without Files",
        nodes: {
          "note-node": {
            id: "note-node",
            type: "note",
          },
        },
        connections: [],
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
        },
        metadata: {
          savedFrom: "db-only-e2e-clean",
        },
        timestamp: 1770000102000,
      },
    });
    assert.equal(clearBindingsResponse.status, 200);
    assert.equal(Object.keys(clearBindingsResponse.body.data?.workflow.nodes ?? {}).length, 1);

    const clearedBindingRows = await context.pool.query<{ total: number }>(
      "select count(*)::int as total from workflow_file_bindings where workflow_id = $1",
      [workflowId],
    );
    assert.equal(clearedBindingRows.rows[0]?.total, 0);

    const deleteWorkflowResponse = await requestJson<{
      workflowId: string;
      deleted: true;
    }>(api.baseUrl, `/api/v1/workflows/${workflowId}`, {
      method: "DELETE",
      headers: bearer(owner.accessToken),
    });
    assert.equal(deleteWorkflowResponse.status, 200);
    assert.equal(deleteWorkflowResponse.body.data?.workflowId, workflowId);
    assert.equal(deleteWorkflowResponse.body.data?.deleted, true);

    const afterDeleteRows = await context.pool.query<{
      workflows: number;
      bindings: number;
      file_assets: number;
    }>(
      `
        select
          (select count(*)::int from workflows where id = $1) as workflows,
          (select count(*)::int from workflow_file_bindings where workflow_id = $1) as bindings,
          (select count(*)::int from file_assets where id = $2::uuid) as file_assets
      `,
      [workflowId, sourceFile.fileId],
    );
    assert.equal(afterDeleteRows.rows[0]?.workflows, 0);
    assert.equal(afterDeleteRows.rows[0]?.bindings, 0);
    assert.equal(afterDeleteRows.rows[0]?.file_assets, 1);

    const deleteGroupResponse = await requestJson<{
      groupId: string;
      movedWorkflowCount: number;
      deleted: true;
    }>(api.baseUrl, `/api/v1/workflows/groups/${groupId}`, {
      method: "DELETE",
      headers: bearer(owner.accessToken),
    });
    assert.equal(deleteGroupResponse.status, 200);
    assert.equal(deleteGroupResponse.body.data?.groupId, groupId);
    assert.equal(deleteGroupResponse.body.data?.movedWorkflowCount, 0);
    assert.equal(deleteGroupResponse.body.data?.deleted, true);

    const deletedGroupRows = await context.pool.query<{ total: number }>(
      "select count(*)::int as total from workflow_groups where id = $1",
      [groupId],
    );
    assert.equal(deletedGroupRows.rows[0]?.total, 0);

    assert.equal(await exists(legacyWorkflowsDir), false);
    assert.equal(await exists(path.join(legacyWorkflowsDir, "index.json")), false);
    assert.equal(await exists(path.join(legacyWorkflowsDir, workflowId, "workflow.json")), false);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
