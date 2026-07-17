import type {
  DatabaseConfig,
} from "@newworkflow/backend-shared";
import {
  queryPostgres,
  withTransaction,
} from "@newworkflow/backend-shared";
import type {
  IntermediateArtifactQuery,
  IntermediateArtifactRecord,
  IntermediateArtifactRepository,
} from "./intermediate-artifact.repository.types.ts";

interface IntermediateArtifactDbRow extends Record<string, unknown> {
  id: string;
  source_blob_id: string;
  artifact_type: IntermediateArtifactRecord["artifactType"];
  file_id: string | null;
  provider: string;
  model: string;
  pipeline_version: string;
  prompt_version: string;
  status: IntermediateArtifactRecord["status"];
  last_task_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_used_at: Date | string | null;
}

const INTERMEDIATE_ARTIFACT_COLUMNS = `
  id::text,
  source_blob_id::text,
  artifact_type,
  file_id::text,
  provider,
  model,
  pipeline_version,
  prompt_version,
  status,
  last_task_id::text,
  created_at,
  updated_at,
  last_used_at
`;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toIntermediateArtifactRecord(row: IntermediateArtifactDbRow): IntermediateArtifactRecord {
  return {
    id: row.id,
    sourceBlobId: row.source_blob_id,
    artifactType: row.artifact_type,
    fileId: row.file_id,
    provider: row.provider,
    model: row.model,
    pipelineVersion: row.pipeline_version,
    promptVersion: row.prompt_version,
    imageSize: null,
    aspectRatio: null,
    status: row.status,
    lastTaskId: row.last_task_id,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    lastUsedAt: nullableIsoString(row.last_used_at),
  };
}

export class DbIntermediateArtifactRepository implements IntermediateArtifactRepository {
  private readonly databaseConfig: DatabaseConfig;

  constructor(databaseConfig: DatabaseConfig) {
    this.databaseConfig = databaseConfig;
  }

  async findByKey(query: IntermediateArtifactQuery): Promise<IntermediateArtifactRecord | null> {
    const result = await queryPostgres<IntermediateArtifactDbRow>(
      this.databaseConfig,
      `
        select ${INTERMEDIATE_ARTIFACT_COLUMNS}
        from intermediate_artifacts
        where source_blob_id = $1::uuid
          and artifact_type = $2
          and provider = $3
          and model = $4
          and pipeline_version = $5
          and prompt_version = $6
        limit 1
      `,
      this.queryValues(query),
    );

    return result.rows[0] ? toIntermediateArtifactRecord(result.rows[0]) : null;
  }

  async touchLastUsed(id: string): Promise<IntermediateArtifactRecord | null> {
    const result = await queryPostgres<IntermediateArtifactDbRow>(
      this.databaseConfig,
      `
        update intermediate_artifacts
        set
          last_used_at = now(),
          updated_at = now()
        where id = $1::uuid
        returning ${INTERMEDIATE_ARTIFACT_COLUMNS}
      `,
      [id],
    );

    return result.rows[0] ? toIntermediateArtifactRecord(result.rows[0]) : null;
  }

  async findOrCreateProcessing(
    query: IntermediateArtifactQuery,
    lastTaskId: string | null,
  ): Promise<{
    record: IntermediateArtifactRecord;
    created: boolean;
    owner: boolean;
  }> {
    return await withTransaction(this.databaseConfig, async (client) => {
      const inserted = await client.query<IntermediateArtifactDbRow>(
        `
          insert into intermediate_artifacts (
            source_blob_id,
            artifact_type,
            file_id,
            provider,
            model,
            pipeline_version,
            prompt_version,
            status,
            last_task_id
          )
          values ($1::uuid, $2, null, $3, $4, $5, $6, 'processing', $7::uuid)
          on conflict (
            source_blob_id,
            artifact_type,
            provider,
            model,
            pipeline_version,
            prompt_version
          ) do nothing
          returning ${INTERMEDIATE_ARTIFACT_COLUMNS}
        `,
        [
          ...this.queryValues(query),
          lastTaskId,
        ],
      );

      if (inserted.rows[0]) {
        return {
          record: toIntermediateArtifactRecord(inserted.rows[0]),
          created: true,
          owner: true,
        };
      }

      const existing = await client.query<IntermediateArtifactDbRow>(
        `
          select ${INTERMEDIATE_ARTIFACT_COLUMNS}
          from intermediate_artifacts
          where source_blob_id = $1::uuid
            and artifact_type = $2
            and provider = $3
            and model = $4
            and pipeline_version = $5
            and prompt_version = $6
          limit 1
        `,
        this.queryValues(query),
      );

      if (!existing.rows[0]) {
        throw new Error("INTERMEDIATE_ARTIFACT_CONFLICT_NOT_FOUND");
      }

      return {
        record: toIntermediateArtifactRecord(existing.rows[0]),
        created: false,
        owner: false,
      };
    });
  }

  async markReady(input: {
    id: string;
    fileId: string;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord> {
    const result = await queryPostgres<IntermediateArtifactDbRow>(
      this.databaseConfig,
      `
        update intermediate_artifacts
        set
          file_id = $2::uuid,
          status = 'ready',
          last_task_id = $3::uuid,
          updated_at = now(),
          last_used_at = now()
        where id = $1::uuid
        returning ${INTERMEDIATE_ARTIFACT_COLUMNS}
      `,
      [
        input.id,
        input.fileId,
        input.lastTaskId,
      ],
    );

    if (!result.rows[0]) {
      throw new Error("INTERMEDIATE_ARTIFACT_NOT_FOUND");
    }

    return toIntermediateArtifactRecord(result.rows[0]);
  }

  async markFailed(input: {
    id: string;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord> {
    const result = await queryPostgres<IntermediateArtifactDbRow>(
      this.databaseConfig,
      `
        update intermediate_artifacts
        set
          status = 'failed',
          last_task_id = $2::uuid,
          updated_at = now()
        where id = $1::uuid
        returning ${INTERMEDIATE_ARTIFACT_COLUMNS}
      `,
      [
        input.id,
        input.lastTaskId,
      ],
    );

    if (!result.rows[0]) {
      throw new Error("INTERMEDIATE_ARTIFACT_NOT_FOUND");
    }

    return toIntermediateArtifactRecord(result.rows[0]);
  }

  private queryValues(query: IntermediateArtifactQuery): [
    string,
    string,
    string,
    string,
    string,
    string,
  ] {
    return [
      query.sourceBlobId,
      query.artifactType,
      query.provider,
      query.model,
      query.pipelineVersion,
      query.promptVersion,
    ];
  }
}
