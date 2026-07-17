import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createEnv,
  createLogger,
} from "@newworkflow/backend-shared";
import {
  createApiServer,
  startApiServer,
  type CreateApiServerOptions,
} from "./composition/create-api-server.ts";

const env = createEnv("api");
const logger = createLogger("api");

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

export {
  createApiServer,
  startApiServer,
};

export type { CreateApiServerOptions };

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);

if (entryPath === modulePath) {
  const server = startApiServer(env);

  server.on("error", (error) => {
    logger.error("API server error", {
      error: serializeError(error),
    });
  });
}

process.on("uncaughtExceptionMonitor", (error, origin) => {
  logger.error("API uncaught exception", {
    origin,
    error: serializeError(error),
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error("API unhandled rejection", {
    reason: serializeError(reason),
  });
});
