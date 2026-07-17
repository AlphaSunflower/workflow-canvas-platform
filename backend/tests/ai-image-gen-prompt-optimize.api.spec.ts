import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApiServer } from "../api/src/main.ts";
import type { AuthenticatedAccount } from "../api/src/modules/auth/auth.service.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import type { PromptOptimizeRequest } from "../api/src/modules/ai/prompt-optimize.dto.ts";
import type { PromptOptimizeResponseData } from "../api/src/modules/ai/prompt-optimize.dto.ts";
import type { PromptOptimizeService } from "../api/src/modules/ai/prompt-optimize.service.ts";
import {
  AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION,
} from "../api/src/modules/ai/prompt-optimize.constants.ts";
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

class PromptOptimizeServiceStub {
  calls: Array<{
    authenticated: AuthenticatedAccount;
    request: PromptOptimizeRequest;
  }> = [];

  error: Error | ExecutionError | null = null;

  async optimizePromptForActor(
    authenticated: AuthenticatedAccount,
    request: PromptOptimizeRequest,
  ): Promise<PromptOptimizeResponseData> {
    this.calls.push({ authenticated, request });

    if (this.error) {
      throw this.error;
    }

    return {
      optimizedPrompt: "优化后的中文提示词",
      model: "gemini-2.5-flash",
      referenceCount: request.referenceFileIds.length,
      promptVersion: AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION,
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
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-optimize-api-test-"));
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
    const serviceStub = new PromptOptimizeServiceStub();
    const authFactory = () => AuthService.fromRoot(rootDir, env);

    server = createApiServer(env, {
      authServiceFactory: authFactory,
      promptOptimizeServiceFactory: () => serviceStub as unknown as PromptOptimizeService,
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
      email: "member@example.com",
      password: "password123",
      displayName: "Member User",
    });
    assert.equal(registerResponse.status, 201);
    const authHeaders = {
      Authorization: `Bearer ${registerResponse.body.data!.tokens.accessToken}`,
    };

    const successResponse = await postJson<PromptOptimizeResponseData>(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        prompt: "  改成欧式风格  ",
        referenceFileIds: ["file-1", "file-2"],
      },
      authHeaders,
    );

    assert.equal(successResponse.status, 200);
    assert.equal(successResponse.body.code, 0);
    assert.equal(successResponse.body.data?.optimizedPrompt, "优化后的中文提示词");
    assert.equal(successResponse.body.data?.model, "gemini-2.5-flash");
    assert.equal(successResponse.body.data?.referenceCount, 2);
    assert.equal(successResponse.body.data?.promptVersion, AI_IMAGE_GEN_PROMPT_OPTIMIZE_PROMPT_VERSION);
    assert.equal(serviceStub.calls.length, 1);
    assert.equal(serviceStub.calls[0]?.authenticated.user.email, "member@example.com");
    assert.deepEqual(serviceStub.calls[0]?.request, {
      workflowId: "workflow-1",
      nodeId: "node-1",
      nodeType: "aiImageGen",
      prompt: "改成欧式风格",
      referenceFileIds: ["file-1", "file-2"],
    });

    const textOnlyResponse = await postJson<PromptOptimizeResponseData>(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        prompt: "  设计一张电商主图  ",
        referenceFileIds: [],
      },
      authHeaders,
    );

    assert.equal(textOnlyResponse.status, 200);
    assert.equal(textOnlyResponse.body.code, 0);
    assert.equal(textOnlyResponse.body.data?.referenceCount, 0);
    assert.deepEqual(serviceStub.calls[1]?.request, {
      workflowId: "workflow-1",
      nodeId: "node-1",
      nodeType: "aiImageGen",
      prompt: "设计一张电商主图",
      referenceFileIds: [],
    });

    const invalidNodeType = await postJson(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiVideoGen",
        prompt: "提示词",
        referenceFileIds: ["file-1"],
      },
      authHeaders,
    );
    assert.equal(invalidNodeType.status, 400);
    assert.equal(invalidNodeType.body.error, "INVALID_NODE_TYPE");

    const invalidPrompt = await postJson(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        prompt: "   ",
        referenceFileIds: ["file-1"],
      },
      authHeaders,
    );
    assert.equal(invalidPrompt.status, 400);
    assert.equal(invalidPrompt.body.error, "INVALID_PROMPT");

    const invalidReferenceCount = await postJson(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        prompt: "提示词",
        referenceFileIds: ["1", "2", "3", "4", "5", "6"],
      },
      authHeaders,
    );
    assert.equal(invalidReferenceCount.status, 400);
    assert.equal(invalidReferenceCount.body.error, "INVALID_REFERENCE_FILE_COUNT");

    const unauthorized = await postJson(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        prompt: "提示词",
        referenceFileIds: ["file-1"],
      },
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error, "AUTHORIZATION_REQUIRED");

    serviceStub.error = new Error("FILE_ACCESS_FORBIDDEN");
    const forbidden = await postJson(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        prompt: "提示词",
        referenceFileIds: ["file-forbidden"],
      },
      authHeaders,
    );
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, "AUTH_FORBIDDEN");

    serviceStub.error = {
      code: ERROR_CODES.providerError,
      message: "老张视觉理解 API 调用失败。",
      category: ERROR_CATEGORIES.providerRetryable,
      retryable: true,
      provider: "laozhang",
      providerCode: "502",
    };
    const providerFailed = await postJson(
      baseUrl,
      "/api/v1/ai/prompt-optimize",
      {
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "aiImageGen",
        prompt: "提示词",
        referenceFileIds: ["file-1"],
      },
      authHeaders,
    );
    assert.equal(providerFailed.status, 502);
    assert.equal(providerFailed.body.error, ERROR_CODES.providerError);
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
