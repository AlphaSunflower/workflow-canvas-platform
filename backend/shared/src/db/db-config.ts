export type PersistenceMode = "json" | "db";

export interface DatabaseConfig {
  url: string | null;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string | null;
  ssl: boolean;
  maxPoolSize: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
  healthcheckTimeoutMillis: number;
}

export interface DatabaseSchemaHealth {
  enabled: boolean;
  status: "disabled" | "ok" | "missing" | "error";
  requiredTables: string[];
  missingTables: string[];
  latencyMs: number | null;
  checkedAt: string;
  errorMessage: string | null;
}

export interface DatabaseHealth {
  enabled: boolean;
  status: "disabled" | "ok" | "error";
  mode: PersistenceMode;
  latencyMs: number | null;
  checkedAt: string;
  schema: DatabaseSchemaHealth;
  errorMessage: string | null;
}

export function isPersistenceMode(value: string): value is PersistenceMode {
  return value === "json" || value === "db";
}

export function getDatabaseDisplayTarget(config: DatabaseConfig): string {
  if (config.url) {
    return "url";
  }

  return `${config.host}:${config.port}/${config.database}`;
}
