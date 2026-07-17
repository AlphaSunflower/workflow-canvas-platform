import { createEnv, createLogger } from "@newworkflow/backend-shared";
import { createWorkerDependencies } from "./composition/create-worker-dependencies.ts";
import { WorkerApp } from "./app.ts";

const logger = createLogger("worker-main");
const env = createEnv("worker");
const app = new WorkerApp(createWorkerDependencies({ env }));

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

async function boot(): Promise<void> {
  logger.info("Worker boot configuration loaded", {
    configPath: env.configPath,
    runninghubConfigured: Boolean(env.runninghubApiKey),
    runninghubApiBaseUrl: env.runninghubApiBaseUrl,
    runninghubMaxConcurrency: env.runninghubMaxConcurrency,
    laozhangVeoConfigured: Boolean(env.laozhangApiKey),
    laozhangVeoApiBaseUrl: env.laozhangVeoApiBaseUrl,
    laozhangVeoMaxConcurrency: env.laozhangVeoMaxConcurrency,
    runninghubTaskCoverage: ["aiImageToPly", "aiMultiViewRestore"],
    laozhangVeoTaskCoverage: ["aiVideoGen", "video-gen"],
  });
  await app.start();
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info("Worker shutting down", { signal });

  try {
    await app.stop();
    process.exit(0);
  } catch (error) {
    logger.error("Worker shutdown failed", {
      error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("uncaughtExceptionMonitor", (error, origin) => {
  logger.error("Worker uncaught exception", {
    origin,
    error: serializeError(error),
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error("Worker unhandled rejection", {
    reason: serializeError(reason),
  });
});

void boot().catch((error) => {
  logger.error("Worker boot failed", {
    error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
  });
  process.exit(1);
});
