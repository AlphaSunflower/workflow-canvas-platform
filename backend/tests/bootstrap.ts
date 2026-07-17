import fs from "node:fs/promises";

import type { ServiceEnv } from "../shared/src/env.ts";
import { createApiTestHarness } from "../api/src/composition/api-test-harness.ts";
import { AuthService } from "../api/src/modules/auth/auth.service.ts";
import { ExecutionQueryService } from "../api/src/modules/executions/execution-query.service.ts";
import { ExecutionsService } from "../api/src/modules/executions/executions.service.ts";
import { FilesService } from "../api/src/modules/files/files.service.ts";
import { UsersService } from "../api/src/modules/users/users.service.ts";
import { WorkflowsService } from "../api/src/modules/workflows/workflows.service.ts";

const TEST_RM_RETRYABLE_CODES = new Set([
  "EBUSY",
  "ENOTEMPTY",
  "EPERM",
]);
const originalRm = fs.rm.bind(fs);

(
  fs as typeof fs & {
    rm: typeof fs.rm;
  }
).rm = (async (...args: Parameters<typeof fs.rm>) => {
  const [targetPath, options] = args;
  const maxAttempts = options?.recursive ? 8 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await originalRm(targetPath, options);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException | undefined)?.code;

      if (attempt >= maxAttempts || !TEST_RM_RETRYABLE_CODES.has(errorCode ?? "")) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 50);
      });
    }
  }
}) as typeof fs.rm;

declare module "../api/src/modules/auth/auth.service.ts" {
  namespace AuthService {
    function fromRoot(rootDir: string, env: ServiceEnv): AuthService;
  }
}

declare module "../api/src/modules/users/users.service.ts" {
  namespace UsersService {
    function fromRoot(rootDir: string, env: ServiceEnv): UsersService;
  }
}

declare module "../api/src/modules/files/files.service.ts" {
  namespace FilesService {
    function fromRoot(rootDir: string): FilesService;
  }
}

declare module "../api/src/modules/workflows/workflows.service.ts" {
  namespace WorkflowsService {
    function fromRoot(rootDir: string): WorkflowsService;
  }
}

declare module "../api/src/modules/executions/executions.service.ts" {
  namespace ExecutionsService {
    function fromRoot(rootDir: string): ExecutionsService;
  }
}

declare module "../api/src/modules/executions/execution-query.service.ts" {
  namespace ExecutionQueryService {
    function fromRoot(rootDir: string): ExecutionQueryService;
  }
}

function createDefaultTestServiceEnv(): ServiceEnv {
  return {
    authAccessTokenSecret: null,
    authAccessTokenTtlSeconds: 3600,
    authBootstrapAdminDisplayName: "System Admin",
    authBootstrapAdminEmail: null,
    authBootstrapAdminPassword: null,
    authIssuer: "newworkflow-backend",
    authRefreshTokenSecret: null,
    authRefreshTokenTtlSeconds: 2_592_000,
    authRotateRefreshTokenOnUse: true,
    configPath: "",
    database: {
      url: null,
      host: "127.0.0.1",
      port: 5432,
      database: "newworkflow_test",
      user: "postgres",
      password: null,
      ssl: false,
      maxPoolSize: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
      statementTimeoutMillis: 30000,
      healthcheckTimeoutMillis: 1000,
    },
    host: "127.0.0.1",
    laozhangApiKey: null,
    laozhangApiUrl: "",
    laozhangOpenaiApiBaseUrl: "",
    laozhangSora2OfficialApiBaseUrl: "",
    laozhangSora2OfficialApiKey: null,
    laozhangVisionApiUrl: "",
    laozhangVisionModel: "",
    laozhangVisionTimeoutMs: 180000,
    laozhangVeoApiBaseUrl: "",
    laozhangVeoMaxConcurrency: null,
    laozhangVeoPollIntervalMs: 5000,
    laozhangVeoTimeoutMs: 600000,
    nodeEnv: "test",
    objectStorage: {
      provider: "local",
      endpoint: null,
      region: "us-east-1",
      bucket: null,
      accessKeyId: null,
      secretAccessKey: null,
      forcePathStyle: true,
      publicBaseUrl: null,
    },
    persistenceMode: "json",
    port: 0,
    providerSnapshotDir: "data/provider-snapshots",
    runninghubApiBaseUrl: null,
    runninghubApiKey: null,
    runninghubMaxConcurrency: 3,
    serviceName: "api",
    workerPollIntervalMs: 5000,
  };
}

(
  AuthService as typeof AuthService & {
    fromRoot(rootDir: string, env: ServiceEnv): AuthService;
  }
).fromRoot = (rootDir, env) => createApiTestHarness(rootDir, env).createAuthService();

(
  UsersService as typeof UsersService & {
    fromRoot(rootDir: string, env: ServiceEnv): UsersService;
  }
).fromRoot = (rootDir, env) => createApiTestHarness(rootDir, env).createUsersService();

(
  FilesService as typeof FilesService & {
    fromRoot(rootDir: string): FilesService;
  }
).fromRoot = (rootDir) =>
  createApiTestHarness(rootDir, createDefaultTestServiceEnv()).createFilesService();

(
  WorkflowsService as typeof WorkflowsService & {
    fromRoot(rootDir: string): WorkflowsService;
  }
).fromRoot = (rootDir) =>
  createApiTestHarness(rootDir, createDefaultTestServiceEnv()).createWorkflowsService();

(
  ExecutionsService as typeof ExecutionsService & {
    fromRoot(rootDir: string): ExecutionsService;
  }
).fromRoot = (rootDir) =>
  createApiTestHarness(rootDir, createDefaultTestServiceEnv()).createExecutionsService();

(
  ExecutionQueryService as typeof ExecutionQueryService & {
    fromRoot(rootDir: string): ExecutionQueryService;
  }
).fromRoot = (rootDir) =>
  createApiTestHarness(rootDir, createDefaultTestServiceEnv()).createExecutionQueryService();
