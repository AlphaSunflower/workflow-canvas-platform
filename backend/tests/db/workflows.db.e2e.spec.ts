import assert from "node:assert/strict";

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

async function run(): Promise<void> {
  const context = await createDbE2EContext("workflows");
  const api = await startDbApi(context);

  try {
    const owner = await registerAccount(api.baseUrl, {
      email: "workflow-owner@example.com",
      password: "workflow-owner-pass",
      displayName: "Workflow Owner",
    });
    const other = await registerAccount(api.baseUrl, {
      email: "workflow-other@example.com",
      password: "workflow-other-pass",
      displayName: "Workflow Other",
    });
    const sourceFile = await registerAndUploadFile(api.baseUrl, owner.accessToken, {
      originalName: "workflow-source.png",
    });

    const createResponse = await requestJson<{
      workflowId: string;
      ownerUserId: string;
      workflow: {
        name: string;
        nodes: Record<string, unknown>;
      };
    }>(api.baseUrl, "/api/v1/workflows", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        id: "workflow-db-e2e",
        projectId: "project-db-e2e",
        name: "DB E2E Workflow",
        nodes: {
          "file-node": {
            id: "file-node",
            type: "image",
            fileId: sourceFile.fileId,
            imageAsset: {
              transient: true,
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
        },
        connections: [],
        viewport: {
          x: 10,
          y: 20,
          zoom: 0.75,
        },
        metadata: {
          source: "db-e2e",
        },
        timestamp: 1770000000000,
      },
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.body.data?.workflowId, "workflow-db-e2e");
    assert.equal(createResponse.body.data?.ownerUserId, owner.userId);

    const bindingCount = await context.pool.query<{ total: number }>(
      "select count(*)::int as total from workflow_file_bindings where workflow_id = $1",
      ["workflow-db-e2e"],
    );
    assert.equal(bindingCount.rows[0]?.total, 2);

    const listResponse = await requestJson<{
      total: number;
      items: Array<{ workflowId: string; name: string; nodeCount: number }>;
    }>(api.baseUrl, "/api/v1/workflows", {
      headers: bearer(owner.accessToken),
    });
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.data?.total, 1);
    assert.equal(listResponse.body.data?.items[0]?.workflowId, "workflow-db-e2e");
    assert.equal(listResponse.body.data?.items[0]?.nodeCount, 2);

    const getResponse = await requestJson<{
      workflowId: string;
      workflow: {
        name: string;
        nodes: Record<string, Record<string, unknown>>;
        metadata: Record<string, unknown>;
      };
    }>(api.baseUrl, "/api/v1/workflows/workflow-db-e2e", {
      headers: bearer(owner.accessToken),
    });
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.data?.workflow.name, "DB E2E Workflow");
    assert.equal(getResponse.body.data?.workflow.metadata.source, "db-e2e");
    assert.equal(getResponse.body.data?.workflow.nodes["file-node"]?.fileId, sourceFile.fileId);
    assert.equal(getResponse.body.data?.workflow.nodes["file-node"]?.previewUrl, `/api/v1/files/${sourceFile.fileId}/preview`);

    const forbiddenGet = await requestJson(api.baseUrl, "/api/v1/workflows/workflow-db-e2e", {
      headers: bearer(other.accessToken),
    });
    assert.equal(forbiddenGet.status, 403);

    const updateResponse = await requestJson<{
      workflowId: string;
      workflow: {
        name: string;
        version: number;
        nodes: Record<string, unknown>;
      };
    }>(api.baseUrl, "/api/v1/workflows/workflow-db-e2e", {
      method: "PUT",
      headers: bearer(owner.accessToken),
      payload: {
        projectId: "project-db-e2e",
        name: "DB E2E Workflow Updated",
        nodes: {
          "text-node": {
            id: "text-node",
            type: "note",
          },
        },
        connections: [],
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
        },
        metadata: {},
        timestamp: 1770000001000,
      },
    });
    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.data?.workflow.name, "DB E2E Workflow Updated");
    assert.equal(updateResponse.body.data?.workflow.version, 2);

    const updatedBindingCount = await context.pool.query<{ total: number }>(
      "select count(*)::int as total from workflow_file_bindings where workflow_id = $1",
      ["workflow-db-e2e"],
    );
    assert.equal(updatedBindingCount.rows[0]?.total, 0);

    const fileStillExists = await context.pool.query<{ total: number }>(
      "select count(*)::int as total from file_assets where id = $1::uuid",
      [sourceFile.fileId],
    );
    assert.equal(fileStillExists.rows[0]?.total, 1);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
