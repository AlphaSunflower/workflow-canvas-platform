import type { IntermediateArtifactType } from "@newworkflow/backend-shared";

export interface IntermediateArtifactRecord {
  id: string;
  sourceBlobId: string;
  artifactType: IntermediateArtifactType;
  fileId: string | null;
  provider: string;
  model: string;
  pipelineVersion: string;
  promptVersion: string;
  imageSize: string | null;
  aspectRatio: string | null;
  status: "processing" | "ready" | "failed";
  lastTaskId: string | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export interface IntermediateArtifactQuery {
  sourceBlobId: string;
  artifactType: IntermediateArtifactType;
  provider: string;
  model: string;
  pipelineVersion: string;
  promptVersion: string;
  imageSize?: string | null;
  aspectRatio?: string | null;
}

export interface IntermediateArtifactRepository {
  findByKey(query: IntermediateArtifactQuery): Promise<IntermediateArtifactRecord | null>;
  touchLastUsed(id: string): Promise<IntermediateArtifactRecord | null>;
  findOrCreateProcessing(
    query: IntermediateArtifactQuery,
    lastTaskId: string | null,
  ): Promise<{
    record: IntermediateArtifactRecord;
    created: boolean;
    owner: boolean;
  }>;
  markReady(input: {
    id: string;
    fileId: string;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord>;
  markFailed(input: {
    id: string;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord>;
}
