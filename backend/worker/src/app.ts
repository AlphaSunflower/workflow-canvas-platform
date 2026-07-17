import http from "node:http";

import {
  AI_VIDEO_GEN_PROVIDER,
  checkPostgresHealth,
  type WorkerProviderSchedulingHealth,
  type WorkerSchedulingHealthResponseData,
  createLogger,
  sendApiError,
  sendJson,
} from "@newworkflow/backend-shared";
import type { ServiceEnv } from "@newworkflow/backend-shared";
import { ExecutionRunService } from "./modules/execution-run/execution-run.service.ts";
import { ProviderSnapshotCleanerService } from "./modules/providers/provider-snapshot-cleaner.service.ts";
import { QueueService } from "./modules/queue/queue.service.ts";

export interface WorkerAppDependencies {
  env: ServiceEnv;
  executionRunService: ExecutionRunService;
  providerSnapshotCleanerService: ProviderSnapshotCleanerService;
  queueService: QueueService;
}

export class WorkerApp {
  private readonly env: ServiceEnv;
  private readonly logger = createLogger("worker");
  private readonly queueService: QueueService;
  private readonly executionRunService: ExecutionRunService;
  private readonly providerSnapshotCleanerService: ProviderSnapshotCleanerService;
  private readonly server: http.Server;
  private listeningPort: number | null = null;

  constructor(dependencies: WorkerAppDependencies) {
    this.env = dependencies.env;
    this.queueService = dependencies.queueService;
    this.executionRunService = dependencies.executionRunService;
    this.providerSnapshotCleanerService = dependencies.providerSnapshotCleanerService;

    this.server = http.createServer((request, response) => {
      if (request.method === "GET" && request.url === "/healthz") {
        void this.handleHealthz(response);
        return;
      }

      sendApiError(response, 404, 40400, "NOT_FOUND", "Route not found.");
    });
  }

  private async handleHealthz(response: http.ServerResponse): Promise<void> {
    try {
      const databaseHealth = await checkPostgresHealth(
        this.env.persistenceMode,
        this.env.database,
      );
      const serviceStatus = databaseHealth.status === "error" ? "degraded" : "ok";
      const executionHealth = this.executionRunService.getHealth();
      const queueHealth = this.queueService.getHealth();
      const getSchedulingProviderHealth = (
        providerKey: string,
        fallback: { max: number | null; available: number | null },
      ): WorkerProviderSchedulingHealth => {
        const providerHealth =
          queueHealth.providerConcurrency.providers[providerKey]
          ?? {
            active: 0,
            ...fallback,
          };
        const lastBackpressure =
          queueHealth.lastProviderBackpressure?.provider === providerKey
            ? queueHealth.lastProviderBackpressure
            : null;

        return {
          active: providerHealth.active,
          max: providerHealth.max,
          available: providerHealth.available,
          queued: queueHealth.queuedTaskCountByProvider[providerKey] ?? 0,
          lastBackpressureAt: lastBackpressure?.occurredAt ?? null,
          lastBackpressureCode: lastBackpressure?.providerCode ?? null,
          lastDispatchKickAt:
            queueHealth.lastDispatchKickScheduledAt
            ?? executionHealth.lastKickAt,
        };
      };

      const payload: WorkerSchedulingHealthResponseData = {
        service: "backend-worker",
        status: serviceStatus,
        port: this.listeningPort ?? this.env.port,
        persistenceMode: this.env.persistenceMode,
        database: databaseHealth,
        pollIntervalMs: this.env.workerPollIntervalMs,
        runninghubMaxConcurrency: this.env.runninghubMaxConcurrency,
        execution: executionHealth,
        queue: queueHealth,
        scheduling: {
          runninghub: getSchedulingProviderHealth("runninghub", {
            max: this.env.runninghubMaxConcurrency,
            available: this.env.runninghubMaxConcurrency,
          }),
          [AI_VIDEO_GEN_PROVIDER]: getSchedulingProviderHealth(AI_VIDEO_GEN_PROVIDER, {
            max: this.env.laozhangVeoMaxConcurrency,
            available: this.env.laozhangVeoMaxConcurrency,
          }),
        },
        timestamp: new Date().toISOString(),
      };
      sendJson(response, 200, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendApiError(response, 500, 50000, "HEALTH_CHECK_FAILED", message);
    }
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(this.env.port, this.env.host, () => {
        const address = this.server.address();
        this.listeningPort =
          typeof address === "object" && address ? address.port : this.env.port;
        resolve();
      });
    });

    this.logger.info("Worker service started", {
      host: this.env.host,
      port: this.listeningPort ?? this.env.port,
      nodeEnv: this.env.nodeEnv,
      pollIntervalMs: this.env.workerPollIntervalMs,
      runninghubConfigured: Boolean(this.env.runninghubApiKey),
      runninghubMaxConcurrency: this.env.runninghubMaxConcurrency,
      laozhangVeoConfigured: Boolean(this.env.laozhangApiKey),
      laozhangVeoApiBaseUrl: this.env.laozhangVeoApiBaseUrl,
      laozhangVeoMaxConcurrency: this.env.laozhangVeoMaxConcurrency,
    });

    if (!this.env.runninghubApiKey) {
      this.logger.warn("RunningHub provider is not configured", {
        configPath: this.env.configPath,
        configKey: "providers.runninghub.apiKey",
        impact: "aiImageToPly and aiMultiViewRestore tasks will fail during execution until RunningHub API Key is configured",
      });
    }

    await this.executionRunService.start();
    await this.providerSnapshotCleanerService.start();
  }

  async stop(): Promise<void> {
    await this.providerSnapshotCleanerService.stop();
    await this.executionRunService.stop();

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.logger.info("Worker service stopped", {
      port: this.listeningPort ?? this.env.port,
    });
  }

  getHealth() {
    return this.executionRunService.getHealth();
  }

  getListeningPort(): number | null {
    return this.listeningPort;
  }
}
