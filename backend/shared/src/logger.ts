type LogLevel = "debug" | "info" | "warn" | "error";

interface LogPayload {
  [key: string]: unknown;
}

function log(level: LogLevel, scope: string, message: string, payload?: LogPayload): void {
  const record = {
    level,
    scope,
    message,
    timestamp: new Date().toISOString(),
    ...(payload ? { payload } : {}),
  };

  const line = JSON.stringify(record);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function createLogger(scope: string) {
  return {
    debug(message: string, payload?: LogPayload) {
      log("debug", scope, message, payload);
    },
    info(message: string, payload?: LogPayload) {
      log("info", scope, message, payload);
    },
    warn(message: string, payload?: LogPayload) {
      log("warn", scope, message, payload);
    },
    error(message: string, payload?: LogPayload) {
      log("error", scope, message, payload);
    },
  };
}
