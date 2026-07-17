import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { WorkflowsService } from "../api/src/modules/workflows/workflows.service.ts";
import { createEnv } from "../shared/src/env.ts";

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: string;
  data?: T;
  timestamp: number;
}

async function requestJson<TResponse>(
  baseUrl: string,
  pathname: string,
  options?: {
    method?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
): Promise<{
  status: number;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options?.method ?? "GET",
    headers: {
      ...(options?.payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    },
    ...(options?.payload !== undefined ? { body: JSON.stringify(options.payload) } : {}),
  });

  return {
    status: response.status,
    body: await response.json() as ApiEnvelope<TResponse>,
  };
}

async function registerAndLogin(
  baseUrl: string,
  email: string,
  password: string,
  displayName: string,
): Promise<{
  accessToken: string;
  userId: string;
}> {
  const registerResponse = await requestJson<{
    tokens: {
      accessToken: string;
    };
    user: {
      userId: string;
    };
  }>(baseUrl, "/api/v1/auth/register", {
    method: "POST",
    payload: {
      email,
      password,
      displayName,
    },
  });

  assert.equal(registerResponse.status, 201);

  return {
    accessToken: registerResponse.body.data!.tokens.accessToken,
    userId: registerResponse.body.data!.user.userId,
  };
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "backend-workflows-api-test-"));
  const originalConfigPath = process.env.BACKEND_CONFIG_PATH;
  const configPath = path.join(rootDir, "backend.config.json");
  let server: ReturnType<typeof createApiServer> | null = null;

  await fs.writeFile(configPath, JSON.stringify({
    persistence: {
      mode: "json",
    },
    runtime: {
      host: "127.0.0.1",
    },
    services: {
      api: {
        port: 0,
      },
    },
    auth: {
      jwt: {
        issuer: "newworkflow-backend-test",
        accessTokenSecret: "test-access-secret",
        accessTokenTtlSeconds: 900,
        refreshTokenSecret: "test-refresh-secret",
        refreshTokenTtlSeconds: 7200,
      },
      session: {
        rotateRefreshTokenOnUse: true,
      },
    },
  }, null, 2), "utf8");

  process.env.BACKEND_CONFIG_PATH = configPath;

  try {
    const env = createEnv("api");
    server = createApiServer(env, {
      authServiceFactory: () => AuthService.fromRoot(rootDir, env),
      filesServiceFactory: () => FilesService.fromRoot(rootDir),
      workflowsServiceFactory: () => WorkflowsService.fromRoot(rootDir),
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const owner = await registerAndLogin(
      baseUrl,
      "workflow-owner@example.com",
      "owner-pass-123",
      "Workflow Owner",
    );
    const other = await registerAndLogin(
      baseUrl,
      "workflow-other@example.com",
      "other-pass-123",
      "Workflow Other",
    );

    const createResponse = await requestJson<{
      workflowId: string;
      ownerUserId: string;
      workflow: {
        id?: string;
        projectId: string;
        name: string;
        nodes: Record<string, unknown>;
        connections: unknown[];
        viewport: {
          x: number;
          y: number;
          zoom: number;
        };
        metadata: Record<string, unknown>;
        timestamp: number;
        version?: number;
      };
      createdAt: string;
      updatedAt: string;
    }>(baseUrl, "/api/v1/workflows", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        projectId: "project-alpha",
        name: "Owner Canvas",
        nodes: {
          "node-1": {
            id: "node-1",
            type: "file",
          },
        },
        connections: [
          {
            id: "connection-1",
            sourceId: "node-1",
            targetId: "node-2",
          },
        ],
        viewport: {
          x: 12,
          y: 24,
          zoom: 0.75,
        },
        metadata: {
          nodeCount: 1,
          connectionCount: 1,
        },
        timestamp: 1710000000000,
      },
    });

    assert.equal(createResponse.status, 201);
    assert.equal(createResponse.body.data?.ownerUserId, owner.userId);
    assert.equal(createResponse.body.data?.workflow.projectId, "project-alpha");
    assert.equal(createResponse.body.data?.workflow.name, "Owner Canvas");
    assert.equal(createResponse.body.data?.workflow.viewport.zoom, 0.75);
    assert.ok(createResponse.body.data?.workflowId);

    const workflowId = createResponse.body.data!.workflowId;

    const listResponse = await requestJson<{
      items: Array<{
        workflowId: string;
        ownerUserId: string;
        projectId: string;
        name: string;
        nodeCount: number;
        connectionCount: number;
        timestamp: number;
        version: number;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
    }>(baseUrl, "/api/v1/workflows", {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.data?.total, 1);
    assert.equal(listResponse.body.data?.items[0]?.workflowId, workflowId);
    assert.equal(listResponse.body.data?.items[0]?.ownerUserId, owner.userId);
    assert.equal(listResponse.body.data?.items[0]?.nodeCount, 1);
    assert.equal(listResponse.body.data?.items[0]?.connectionCount, 1);
    assert.equal(
      Object.prototype.hasOwnProperty.call(listResponse.body.data?.items[0] ?? {}, "workflow"),
      false,
    );

    const getResponse = await requestJson<{
      workflowId: string;
      ownerUserId: string;
      workflow: {
        name: string;
        nodes: Record<string, unknown>;
        connections: unknown[];
      };
    }>(baseUrl, `/api/v1/workflows/${workflowId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.body.data?.workflowId, workflowId);
    assert.equal(getResponse.body.data?.ownerUserId, owner.userId);
    assert.equal(getResponse.body.data?.workflow.name, "Owner Canvas");
    assert.equal(Object.keys(getResponse.body.data?.workflow.nodes ?? {}).length, 1);
    assert.equal(getResponse.body.data?.workflow.connections.length, 1);

    const createWithFileResponse = await requestJson<{
      workflowId: string;
      workflow: {
        nodes: Record<string, unknown>;
      };
    }>(baseUrl, "/api/v1/workflows", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        projectId: "project-alpha",
        name: "Owner Canvas With File",
        nodes: {
          "node-file-1": {
            id: "node-file-1",
            type: "image",
            fileId: "file-backend-1",
            fileName: "temp-name.png",
            fileSize: 123,
            mimeType: "image/png",
            previewUrl: "blob:temporary-preview",
            thumbnailUrl: "data:image/png;base64,temporary",
            imageAsset: {
              source: "local",
              variants: {
                preview: {
                  url: "blob:temporary-preview",
                },
              },
            },
            file: {
              raw: true,
            },
            localFile: {
              raw: true,
            },
            objectUrl: "blob:temporary-preview",
            localState: {
              uploaded: false,
            },
            metadata: {
              width: 256,
              height: 256,
            },
          },
          "node-file-linked-1": {
            id: "node-file-linked-1",
            type: "image",
            fileId: "file-backend-1",
            fileName: "linked-name.png",
            fileSize: 123,
            mimeType: "image/png",
            source: {
              type: "imported",
              importMethod: "local",
              sourceDisplayName: "linked-name.png",
              localSource: {
                status: "linked",
                referenceId: "fs-handle-1",
              },
              importedAt: 1710000002222,
            },
            metadata: {
              width: 256,
              height: 256,
            },
          },
          "node-ai-1": {
            id: "node-ai-1",
            type: "aiImageGen",
            references: [
              {
                id: "ref-1",
                nodeId: "node-file-1",
                fileId: "file-backend-1",
                type: "single",
                order: 0,
              },
            ],
            outputs: [],
            config: {},
            tasks: [],
          },
        },
        connections: [],
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
        },
        metadata: {
          nodeCount: 3,
          connectionCount: 0,
        },
        timestamp: 1710000002222,
      },
    });

    assert.equal(createWithFileResponse.status, 201);
    const fileWorkflowId = createWithFileResponse.body.data!.workflowId;
    const fileWorkflowPath = path.join(rootDir, "data", "workflows", fileWorkflowId, "workflow.json");
    const workflowFilesPath = path.join(rootDir, "data", "workflows", fileWorkflowId, "files.json");
    const fileWorkflowRaw = JSON.parse(await fs.readFile(fileWorkflowPath, "utf8")) as {
      workflow: {
        nodes: Record<string, Record<string, unknown>>;
      };
    };
    const workflowFilesRaw = JSON.parse(await fs.readFile(workflowFilesPath, "utf8")) as {
      items: Array<{
        nodeId: string;
        fileId: string;
        role: string;
      }>;
    };

    const persistedFileNode = fileWorkflowRaw.workflow.nodes["node-file-1"];
    assert.equal(persistedFileNode.fileId, "file-backend-1");
    assert.equal("previewUrl" in persistedFileNode, false);
    assert.equal("thumbnailUrl" in persistedFileNode, false);
    assert.equal("imageAsset" in persistedFileNode, false);
    assert.equal("file" in persistedFileNode, false);
    assert.equal("localFile" in persistedFileNode, false);
    assert.equal("objectUrl" in persistedFileNode, false);
    assert.equal("localState" in persistedFileNode, false);

    assert.equal(workflowFilesRaw.items.length, 3);
    assert.equal(
      workflowFilesRaw.items.some((item) =>
        item.nodeId === "node-file-1" && item.fileId === "file-backend-1" && item.role === "file-node"
      ),
      true,
    );
    assert.equal(
      workflowFilesRaw.items.some((item) =>
        item.nodeId === "node-file-linked-1" && item.fileId === "file-backend-1" && item.role === "file-node"
      ),
      true,
    );
    assert.equal(
      workflowFilesRaw.items.some((item) =>
        item.nodeId === "node-ai-1" && item.fileId === "file-backend-1" && item.role === "node-reference"
      ),
      true,
    );

    const filesStorePath = path.join(rootDir, "data", "files", "files-store.json");
    const filesStoreRaw = JSON.parse(await fs.readFile(filesStorePath, "utf8")) as {
      blobs: unknown[];
      files: Array<Record<string, unknown>>;
      pendingUploads: unknown[];
    };
    if (!filesStoreRaw.files.some((file) => file.id === "file-backend-1")) {
      filesStoreRaw.blobs.push({
        id: "blob-backend-1",
        sha256: "a".repeat(64),
        size: 1024,
        mimeType: "image/png",
        storageKey: "blobs/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
        previewStorageKey: "blobs/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.preview.png",
        previewMimeType: "image/png",
        previewSize: 256,
        previewWidth: 512,
        previewHeight: 512,
        thumbnailStorageKey: "blobs/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.thumbnail.png",
        thumbnailMimeType: "image/png",
        thumbnailSize: 128,
        thumbnailWidth: 128,
        thumbnailHeight: 128,
        storageProvider: "local",
        extension: "png",
        width: 512,
        height: 512,
        createdAt: new Date().toISOString(),
      });
      filesStoreRaw.files.push({
        id: "file-backend-1",
        userId: owner.userId,
        blobId: "blob-backend-1",
        originalName: "persisted-image.png",
        displayName: "persisted-image.png",
        mimeType: "image/png",
        fileType: "image",
        sourceType: "input",
        status: "ready",
        pendingUploadId: null,
        sha256: "a".repeat(64),
        size: 1024,
        extension: "png",
        width: 512,
        height: 512,
        previewReady: true,
        previewWidth: 512,
        previewHeight: 512,
        thumbnailReady: true,
        thumbnailWidth: 128,
        thumbnailHeight: 128,
        createdAt: new Date().toISOString(),
      });
      await fs.writeFile(filesStorePath, JSON.stringify(filesStoreRaw, null, 2), "utf8");
    }

    const hydratedWorkflowGet = await requestJson<{
      workflow: {
        nodes: Record<string, {
          previewUrl?: string;
          thumbnailUrl?: string;
          source?: {
            localSource?: {
              status?: string;
              referenceId?: string;
            };
          };
          imageAsset?: {
            variants?: {
              thumbnail?: { url?: string };
              preview?: { url?: string };
              original?: { url?: string };
            };
          };
        }>;
      };
    }>(baseUrl, `/api/v1/workflows/${fileWorkflowId}`, {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(hydratedWorkflowGet.status, 200);
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-1"]?.thumbnailUrl,
      "/api/v1/files/file-backend-1/thumbnail",
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-1"]?.previewUrl,
      "/api/v1/files/file-backend-1/preview",
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-1"]?.imageAsset?.variants?.thumbnail?.url,
      "/api/v1/files/file-backend-1/thumbnail",
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-1"]?.imageAsset?.variants?.preview?.url,
      "/api/v1/files/file-backend-1/preview",
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-1"]?.imageAsset?.variants?.original?.url,
      "/api/v1/files/file-backend-1/download",
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-linked-1"]?.thumbnailUrl,
      undefined,
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-linked-1"]?.previewUrl,
      undefined,
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-linked-1"]?.imageAsset,
      undefined,
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-linked-1"]?.source?.localSource?.status,
      "linked",
    );
    assert.equal(
      hydratedWorkflowGet.body.data?.workflow.nodes["node-file-linked-1"]?.source?.localSource?.referenceId,
      "fs-handle-1",
    );

    const otherGet = await requestJson(baseUrl, `/api/v1/workflows/${workflowId}`, {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });
    assert.equal(otherGet.status, 403);
    assert.equal(otherGet.body.error, "AUTH_FORBIDDEN");

    const updateResponse = await requestJson<{
      workflowId: string;
      workflow: {
        name: string;
        nodes: Record<string, unknown>;
        connections: unknown[];
        metadata: Record<string, unknown>;
        version?: number;
      };
    }>(baseUrl, `/api/v1/workflows/${workflowId}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        projectId: "project-alpha",
        name: "Owner Canvas Updated",
        nodes: {
          "node-1": {
            id: "node-1",
            type: "file",
          },
          "node-2": {
            id: "node-2",
            type: "output",
          },
        },
        connections: [
          {
            id: "connection-1",
            sourceId: "node-1",
            targetId: "node-2",
          },
        ],
        viewport: {
          x: 100,
          y: 200,
          zoom: 1.1,
        },
        metadata: {
          nodeCount: 2,
          connectionCount: 1,
        },
        timestamp: 1710000001234,
      },
    });

    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.data?.workflow.name, "Owner Canvas Updated");
    assert.equal(Object.keys(updateResponse.body.data?.workflow.nodes ?? {}).length, 2);
    assert.ok((updateResponse.body.data?.workflow.version ?? 0) >= 1);

    const updatedListResponse = await requestJson<{
      items: Array<{
        workflowId: string;
        name: string;
        nodeCount: number;
        connectionCount: number;
      }>;
      total: number;
    }>(baseUrl, "/api/v1/workflows", {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(updatedListResponse.status, 200);
    assert.equal(updatedListResponse.body.data?.items[0]?.name, "Owner Canvas Updated");
    assert.equal(updatedListResponse.body.data?.items[0]?.nodeCount, 2);
    assert.equal(updatedListResponse.body.data?.items[0]?.connectionCount, 1);

    const managedInitialResponse = await requestJson<{
      items: Array<{
        workflowId: string;
        groupId: string | null;
        containerKey: string;
        isAutoNamed: boolean;
      }>;
      groups: Array<{
        groupId: string;
        ownerUserId: string;
        name: string;
        workflowCount: number;
      }>;
      total: number;
    }>(baseUrl, "/api/v1/workflows/manage", {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(managedInitialResponse.status, 200);
    assert.equal(managedInitialResponse.body.data?.total, 2);
    assert.equal(managedInitialResponse.body.data?.groups.length, 0);
    assert.equal(
      managedInitialResponse.body.data?.items.some((item) => item.workflowId === workflowId),
      true,
    );

    const createGroupResponse = await requestJson<{
      groupId: string;
      ownerUserId: string;
      name: string;
      workflowCount: number;
    }>(baseUrl, "/api/v1/workflows/groups", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        name: "Group Alpha",
      },
    });

    assert.equal(createGroupResponse.status, 201);
    assert.equal(createGroupResponse.body.data?.ownerUserId, owner.userId);
    assert.equal(createGroupResponse.body.data?.name, "Group Alpha");
    const groupId = createGroupResponse.body.data!.groupId;

    const renameGroupResponse = await requestJson<{
      groupId: string;
      name: string;
    }>(baseUrl, `/api/v1/workflows/groups/${groupId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        name: "Group Beta",
      },
    });

    assert.equal(renameGroupResponse.status, 200);
    assert.equal(renameGroupResponse.body.data?.groupId, groupId);
    assert.equal(renameGroupResponse.body.data?.name, "Group Beta");

    const createBlankResponse = await requestJson<{
      workflowId: string;
      ownerUserId: string;
      groupId: string | null;
      containerKey: string;
      isAutoNamed: boolean;
      workflow: {
        name: string;
        nodes: Record<string, unknown>;
        connections: unknown[];
      };
    }>(baseUrl, "/api/v1/workflows/blank", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        projectId: "project-beta",
        groupId,
      },
    });

    assert.equal(createBlankResponse.status, 201);
    assert.equal(createBlankResponse.body.data?.ownerUserId, owner.userId);
    assert.equal(createBlankResponse.body.data?.groupId, groupId);
    assert.equal(createBlankResponse.body.data?.containerKey, groupId);
    assert.equal(createBlankResponse.body.data?.isAutoNamed, true);
    assert.equal(createBlankResponse.body.data?.workflow.name, "新建画布");
    assert.equal(Object.keys(createBlankResponse.body.data?.workflow.nodes ?? {}).length, 0);
    const blankWorkflowId = createBlankResponse.body.data!.workflowId;

    const renameWorkflowResponse = await requestJson<{
      workflowId: string;
      isAutoNamed: boolean;
      workflow: {
        name: string;
      };
    }>(baseUrl, `/api/v1/workflows/${blankWorkflowId}/name`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        name: "Manual Canvas",
      },
    });

    assert.equal(renameWorkflowResponse.status, 200);
    assert.equal(renameWorkflowResponse.body.data?.workflowId, blankWorkflowId);
    assert.equal(renameWorkflowResponse.body.data?.workflow.name, "Manual Canvas");
    assert.equal(renameWorkflowResponse.body.data?.isAutoNamed, false);

    const moveWorkflowResponse = await requestJson<{
      workflowId: string;
      groupId: string | null;
      containerKey: string;
    }>(baseUrl, `/api/v1/workflows/${workflowId}/group`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
      payload: {
        groupId,
      },
    });

    assert.equal(moveWorkflowResponse.status, 200);
    assert.equal(moveWorkflowResponse.body.data?.workflowId, workflowId);
    assert.equal(moveWorkflowResponse.body.data?.groupId, groupId);
    assert.equal(moveWorkflowResponse.body.data?.containerKey, groupId);

    const managedGroupedResponse = await requestJson<{
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
    }>(baseUrl, "/api/v1/workflows/manage", {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(managedGroupedResponse.status, 200);
    assert.equal(managedGroupedResponse.body.data?.total, 3);
    assert.equal(managedGroupedResponse.body.data?.groups.length, 1);
    assert.equal(managedGroupedResponse.body.data?.groups[0]?.groupId, groupId);
    assert.equal(managedGroupedResponse.body.data?.groups[0]?.name, "Group Beta");
    assert.equal(managedGroupedResponse.body.data?.groups[0]?.workflowCount, 2);
    assert.equal(
      managedGroupedResponse.body.data?.items.find((item) => item.workflowId === workflowId)?.groupId,
      groupId,
    );
    assert.equal(
      managedGroupedResponse.body.data?.items.find((item) => item.workflowId === blankWorkflowId)?.groupId,
      groupId,
    );

    const otherManageResponse = await requestJson<{
      items: unknown[];
      groups: unknown[];
      total: number;
    }>(baseUrl, "/api/v1/workflows/manage", {
      headers: {
        Authorization: `Bearer ${other.accessToken}`,
      },
    });

    assert.equal(otherManageResponse.status, 200);
    assert.equal(otherManageResponse.body.data?.total, 0);
    assert.equal(otherManageResponse.body.data?.items.length, 0);
    assert.equal(otherManageResponse.body.data?.groups.length, 0);

    const otherRenameWorkflowResponse = await requestJson(
      baseUrl,
      `/api/v1/workflows/${workflowId}/name`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${other.accessToken}`,
        },
        payload: {
          name: "Illegal Rename",
        },
      },
    );

    assert.equal(otherRenameWorkflowResponse.status, 403);
    assert.equal(otherRenameWorkflowResponse.body.error, "AUTH_FORBIDDEN");

    const deleteGroupResponse = await requestJson<{
      groupId: string;
      movedWorkflowCount: number;
      deleted: true;
    }>(baseUrl, `/api/v1/workflows/groups/${groupId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(deleteGroupResponse.status, 200);
    assert.equal(deleteGroupResponse.body.data?.groupId, groupId);
    assert.equal(deleteGroupResponse.body.data?.movedWorkflowCount, 2);
    assert.equal(deleteGroupResponse.body.data?.deleted, true);

    const managedAfterGroupDeleteResponse = await requestJson<{
      items: Array<{
        workflowId: string;
        groupId: string | null;
        containerKey: string;
      }>;
      groups: Array<{
        groupId: string;
      }>;
      total: number;
    }>(baseUrl, "/api/v1/workflows/manage", {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(managedAfterGroupDeleteResponse.status, 200);
    assert.equal(managedAfterGroupDeleteResponse.body.data?.groups.length, 0);
    assert.equal(
      managedAfterGroupDeleteResponse.body.data?.items.find((item) => item.workflowId === workflowId)?.groupId,
      null,
    );
    assert.equal(
      managedAfterGroupDeleteResponse.body.data?.items.find((item) => item.workflowId === workflowId)?.containerKey,
      "__ungrouped__",
    );
    assert.equal(
      managedAfterGroupDeleteResponse.body.data?.items.find((item) => item.workflowId === blankWorkflowId)?.groupId,
      null,
    );
    assert.equal(
      managedAfterGroupDeleteResponse.body.data?.items.find((item) => item.workflowId === blankWorkflowId)?.containerKey,
      "__ungrouped__",
    );

    const deleteWorkflowResponse = await requestJson<{
      workflowId: string;
      deleted: true;
    }>(baseUrl, `/api/v1/workflows/${blankWorkflowId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(deleteWorkflowResponse.status, 200);
    assert.equal(deleteWorkflowResponse.body.data?.workflowId, blankWorkflowId);
    assert.equal(deleteWorkflowResponse.body.data?.deleted, true);

    const otherDeleteWorkflowResponse = await requestJson(
      baseUrl,
      `/api/v1/workflows/${workflowId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${other.accessToken}`,
        },
      },
    );

    assert.equal(otherDeleteWorkflowResponse.status, 403);
    assert.equal(otherDeleteWorkflowResponse.body.error, "AUTH_FORBIDDEN");

    const managedAfterWorkflowDeleteResponse = await requestJson<{
      items: Array<{
        workflowId: string;
      }>;
      total: number;
    }>(baseUrl, "/api/v1/workflows/manage", {
      headers: {
        Authorization: `Bearer ${owner.accessToken}`,
      },
    });

    assert.equal(managedAfterWorkflowDeleteResponse.status, 200);
    assert.equal(managedAfterWorkflowDeleteResponse.body.data?.total, 2);
    assert.equal(
      managedAfterWorkflowDeleteResponse.body.data?.items.some((item) => item.workflowId === blankWorkflowId),
      false,
    );

    const workflowFilePath = path.join(rootDir, "data", "workflows", workflowId, "workflow.json");
    const indexPath = path.join(rootDir, "data", "workflows", "index.json");
    const workflowRaw = JSON.parse(await fs.readFile(workflowFilePath, "utf8")) as {
      workflow: {
        name: string;
        nodes: Record<string, unknown>;
      };
    };
    const indexRaw = JSON.parse(await fs.readFile(indexPath, "utf8")) as {
      items: Array<Record<string, unknown>>;
    };

    assert.equal(workflowRaw.workflow.name, "Owner Canvas Updated");
    assert.equal(Object.keys(workflowRaw.workflow.nodes).length, 2);
    assert.equal(indexRaw.items.length, 2);
    assert.equal(indexRaw.items.some((item) => item.workflowId === workflowId), true);
    assert.equal(indexRaw.items.some((item) => item.workflowId === blankWorkflowId), false);
    assert.equal(
      indexRaw.items.every((item) => Object.prototype.hasOwnProperty.call(item, "workflow") === false),
      true,
    );
  } finally {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.closeIdleConnections?.();
        server!.closeAllConnections?.();
        server!.close(() => resolve());
      });
    }

    if (originalConfigPath === undefined) {
      delete process.env.BACKEND_CONFIG_PATH;
    } else {
      process.env.BACKEND_CONFIG_PATH = originalConfigPath;
    }

    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

void run();
