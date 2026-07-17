import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import type { AuthenticatedAccount } from "../api/src/modules/auth/auth.service.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import type {
  StoryboardArrangeRequest,
  StoryboardArrangeResponseData,
} from "../api/src/modules/ai/storyboard-arrange.dto.ts";
import {
  AI_STORYBOARD_ARRANGE_PROMPT_VERSION,
} from "../api/src/modules/ai/storyboard-arrange.constants.ts";
import type { StoryboardArrangeService } from "../api/src/modules/ai/storyboard-arrange.service.ts";
import { createEnv } from "../shared/src/env.ts";
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  type ExecutionError,
} from "../shared/src/index.ts";

interface ApiEnvelope<T> {
  code: number;
  message?: string;
  error?: string;
  data?: T;
  timestamp: number;
}

class StoryboardArrangeServiceStub {
  calls: Array<{
    authenticated: AuthenticatedAccount;
    request: StoryboardArrangeRequest;
  }> = [];

  error: Error | ExecutionError | null = null;

  async arrangeShotsForActor(
    authenticated: AuthenticatedAccount,
    request: StoryboardArrangeRequest,
  ): Promise<StoryboardArrangeResponseData> {
    this.calls.push({ authenticated, request });

    if (this.error) {
      throw this.error;
    }

    return {
      shots: request.shots
        .map((shot, index) => ({
          shotId: shot.shotId,
          order: index + 1,
          prompt: `鏡头 ${index + 1} 的中文运镜提示词`,
        })),
      model: "gemini-3-flash-preview",
      referenceCount: request.shots.length,
      promptVersion: AI_STORYBOARD_ARRANGE_PROMPT_VERSION,
    };
  }
}

async function postJson<TResponse>(
  baseUrl: string,
  pathname: string,
  payload: unknown,
  headers?: Record<string, string>,
): Promise<{
  status: number;
  body: ApiEnvelope<TResponse>;
}> {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  return {
    status: response.status,
    body: await response.json() as ApiEnvelope<TResponse>,
  };
}

async function run(): Promise<void> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "storyboard-arrange-api-test-"));
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
    const serviceStub = new StoryboardArrangeServiceStub();
    const authFactory = () => AuthService.fromRoot(rootDir, env);

    server = createApiServer(env, {
      authServiceFactory: authFactory,
      storyboardArrangeServiceFactory: () => serviceStub as unknown as StoryboardArrangeService,
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const registerResponse = await postJson<{
      tokens: {
        accessToken: string;
      };
      user: {
        userId: string;
      };
    }>(baseUrl, "/api/v1/auth/register", {
      email: "storyboard@example.com",
      password: "password123",
      displayName: "Storyboard User",
    });
    assert.equal(registerResponse.status, 201);

    const authHeaders = {
      Authorization: `Bearer ${registerResponse.body.data!.tokens.accessToken}`,
    };

    const successResponse = await postJson<StoryboardArrangeResponseData>(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [
          {
            shotId: "shot-a",
            order: 2,
            imageFileId: "file-a",
          },
          {
            shotId: "shot-b",
            order: 1,
            imageFileId: "file-b",
          },
        ],
      },
      authHeaders,
    );

    assert.equal(successResponse.status, 200);
    assert.equal(successResponse.body.code, 0);
    assert.equal(successResponse.body.data?.shots.length, 2);
    assert.equal(successResponse.body.data?.shots[0]?.shotId, "shot-a");
    assert.equal(successResponse.body.data?.model, "gemini-3-flash-preview");
    assert.equal(successResponse.body.data?.referenceCount, 2);
    assert.equal(successResponse.body.data?.promptVersion, AI_STORYBOARD_ARRANGE_PROMPT_VERSION);
    assert.equal(serviceStub.calls.length, 1);
    assert.equal(serviceStub.calls[0]?.authenticated.user.email, "storyboard@example.com");
    assert.deepEqual(serviceStub.calls[0]?.request, {
      workflowId: "workflow-1",
      nodeId: "node-1",
      nodeType: "aiStoryboard",
      shots: [
        {
          shotId: "shot-a",
          order: 2,
          imageFileId: "file-a",
        },
        {
          shotId: "shot-b",
          order: 1,
          imageFileId: "file-b",
        },
      ],
    });

    const invalidNodeType = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        shots: [{
          shotId: "shot-a",
          order: 1,
          imageFileId: "file-a",
        }],
      },
      authHeaders,
    );
    assert.equal(invalidNodeType.status, 400);
    assert.equal(invalidNodeType.body.error, "INVALID_NODE_TYPE");

    const invalidShots = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [],
      },
      authHeaders,
    );
    assert.equal(invalidShots.status, 400);
    assert.equal(invalidShots.body.error, "INVALID_SHOTS");

    const duplicateShotId = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [
          { shotId: "shot-a", order: 1, imageFileId: "file-a" },
          { shotId: "shot-a", order: 2, imageFileId: "file-b" },
        ],
      },
      authHeaders,
    );
    assert.equal(duplicateShotId.status, 400);
    assert.equal(duplicateShotId.body.error, "DUPLICATE_SHOT_ID");

    const unauthorized = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [{ shotId: "shot-a", order: 1, imageFileId: "file-a" }],
      },
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error, "AUTHORIZATION_REQUIRED");

    serviceStub.error = new Error("FILE_ACCESS_FORBIDDEN");
    const forbidden = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [{ shotId: "shot-a", order: 1, imageFileId: "file-a" }],
      },
      authHeaders,
    );
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, "AUTH_FORBIDDEN");

    serviceStub.error = new Error("INVALID_PROVIDER_RESULT_JSON");
    const invalidProviderJson = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [{ shotId: "shot-a", order: 1, imageFileId: "file-a" }],
      },
      authHeaders,
    );
    assert.equal(invalidProviderJson.status, 502);
    assert.equal(invalidProviderJson.body.error, "INVALID_PROVIDER_RESULT_JSON");

    serviceStub.error = {
      code: ERROR_CODES.providerError,
      message: "Storyboard arrange provider request failed.",
      category: ERROR_CATEGORIES.providerRetryable,
      retryable: true,
      provider: "laozhang",
      providerCode: "502",
    };
    const providerFailed = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [{ shotId: "shot-a", order: 1, imageFileId: "file-a" }],
      },
      authHeaders,
    );
    assert.equal(providerFailed.status, 502);
    assert.equal(providerFailed.body.error, ERROR_CODES.providerError);

    serviceStub.error = new Error("SHOT_FILE_STORE_BUSY");
    const fileStoreBusy = await postJson(
      baseUrl,
      "/api/v1/ai/storyboard-arrange",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiStoryboard",
        shots: [{ shotId: "shot-a", order: 1, imageFileId: "file-a" }],
      },
      authHeaders,
    );
    assert.equal(fileStoreBusy.status, 503);
    assert.equal(fileStoreBusy.body.error, "SHOT_FILE_STORE_BUSY");
    assert.equal(fileStoreBusy.body.code, 50311);
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
