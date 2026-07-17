import type {
  DatabaseClient,
  QueryResult,
  QueryResultRow,
} from "./postgres-client.ts";
import {
  getPostgresPool,
  type DatabasePool,
} from "./postgres-client.ts";
import type { DatabaseConfig } from "./db-config.ts";

export interface TransactionClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export type TransactionCallback<T> = (client: TransactionClient) => Promise<T>;

async function rollbackQuietly(client: DatabaseClient): Promise<void> {
  try {
    await client.query("rollback");
  } catch {
    // Keep the original transaction error as the caller-visible failure.
  }
}

export async function withTransaction<T>(
  poolOrConfig: DatabasePool | DatabaseConfig,
  callback: TransactionCallback<T>,
): Promise<T> {
  const pool = "connect" in poolOrConfig
    ? poolOrConfig
    : await getPostgresPool(poolOrConfig);
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}
