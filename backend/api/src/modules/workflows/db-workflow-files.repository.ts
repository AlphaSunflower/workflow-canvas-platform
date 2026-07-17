import type { DatabaseConfig } from "@newworkflow/backend-shared";
import {
  queryPostgres,
  withTransaction,
  type DatabasePool,
  type TransactionClient,
} from "@newworkflow/backend-shared";
import type { WorkflowFileBindingRecord } from "./workflow-file-binding.types.ts";
import type { WorkflowFilesRepository } from "./workflow.repository.types.ts";

type DbQueryRow = Record<string, unknown>;

interface WorkflowFileBindingDbRow extends DbQueryRow {
  id: string;
  workflow_id: string;
  owner_user_id: string;
  node_id: string;
  file_id: string;
  role: WorkflowFileBindingRecord["role"];
  created_at: Date | string;
  updated_at: Date | string;
}

export interface DbWorkflowFilesRepositoryOptions {
  pool?: DatabasePool;
}

const WORKFLOW_FILE_BINDING_SELECT_COLUMNS = `
  id::text,
  workflow_id,
  owner_user_id,
  node_id,
  file_id::text,
  role,
  created_at,
  updated_at
`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toBinding(row: WorkflowFileBindingDbRow): WorkflowFileBindingRecord {
  return {
    bindingId: row.id,
    workflowId: row.workflow_id,
    ownerUserId: row.owner_user_id,
    nodeId: row.node_id,
    fileId: row.file_id,
    role: row.role,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export class DbWorkflowFilesRepository implements WorkflowFilesRepository {
  private readonly databaseConfig: DatabaseConfig;
  private readonly pool: DatabasePool | null;

  constructor(databaseConfig: DatabaseConfig, options: DbWorkflowFilesRepositoryOptions = {}) {
    this.databaseConfig = databaseConfig;
    this.pool = options.pool ?? null;
  }

  async ensureInitialized(_workflowId: string): Promise<void> {
    await this.query("select 1 as ok");
  }

  async listBindings(workflowId: string): Promise<WorkflowFileBindingRecord[]> {
    const result = await this.query<WorkflowFileBindingDbRow>(
      `
        select ${WORKFLOW_FILE_BINDING_SELECT_COLUMNS}
        from workflow_file_bindings
        where workflow_id = $1
        order by node_id asc, file_id asc, role asc
      `,
      [workflowId],
    );

    return result.rows.map(toBinding);
  }

  async replaceBindings(
    workflowId: string,
    bindings: WorkflowFileBindingRecord[],
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(
        `
          delete from workflow_file_bindings
          where workflow_id = $1
        `,
        [workflowId],
      );

      for (const binding of bindings) {
        await client.query(
          `
            insert into workflow_file_bindings (
              id,
              workflow_id,
              owner_user_id,
              node_id,
              file_id,
              role,
              created_at,
              updated_at
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (workflow_id, node_id, file_id, role) do update set
              owner_user_id = excluded.owner_user_id,
              updated_at = excluded.updated_at
          `,
          [
            binding.bindingId,
            binding.workflowId,
            binding.ownerUserId,
            binding.nodeId,
            binding.fileId,
            binding.role,
            binding.createdAt,
            binding.updatedAt,
          ],
        );
      }
    });
  }

  async deleteBindings(workflowId: string): Promise<void> {
    await this.query(
      `
        delete from workflow_file_bindings
        where workflow_id = $1
      `,
      [workflowId],
    );
  }

  async query<T extends DbQueryRow = DbQueryRow>(
    text: string,
    values?: readonly unknown[],
  ) {
    if (this.pool) {
      return this.pool.query<T>(text, values);
    }

    return queryPostgres<T>(this.databaseConfig, text, values);
  }

  private async withTransaction<T>(
    callback: (client: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.pool ?? this.databaseConfig, callback);
  }
}
