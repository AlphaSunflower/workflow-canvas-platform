import type {
  DatabaseConfig,
} from "@newworkflow/backend-shared";
import {
  queryPostgres,
} from "@newworkflow/backend-shared";

export interface ProviderCallLogInput {
  taskId: string;
  stepType: string;
  provider: string;
  model: string;
  requestSummary?: Record<string, unknown> | null;
  responseSummary?: Record<string, unknown> | null;
  httpStatus?: number | null;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ProviderCallLogRepository {
  insert(input: ProviderCallLogInput): Promise<void>;
}

export class NoopProviderCallLogRepository implements ProviderCallLogRepository {
  async insert(_input: ProviderCallLogInput): Promise<void> {
    return undefined;
  }
}

export class DbProviderCallLogRepository implements ProviderCallLogRepository {
  private readonly databaseConfig: DatabaseConfig;

  constructor(databaseConfig: DatabaseConfig) {
    this.databaseConfig = databaseConfig;
  }

  async insert(input: ProviderCallLogInput): Promise<void> {
    await queryPostgres(
      this.databaseConfig,
      `
        insert into provider_call_logs (
          task_id,
          attempt_id,
          step_type,
          provider,
          model,
          request_summary,
          response_summary,
          http_status,
          success,
          error_code,
          error_message,
          started_at,
          completed_at
        )
        values (
          $1::uuid,
          null,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7,
          $8,
          $9,
          $10,
          coalesce($11::timestamptz, now()),
          coalesce($12::timestamptz, now())
        )
      `,
      [
        input.taskId,
        input.stepType,
        input.provider,
        input.model,
        JSON.stringify(input.requestSummary ?? {}),
        JSON.stringify(input.responseSummary ?? {}),
        input.httpStatus ?? null,
        input.success,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
      ],
    );
  }
}
