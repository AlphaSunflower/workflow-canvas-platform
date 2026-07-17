import {
  WHITE_MODEL_RENDER_DEFAULT_MODEL,
  WHITE_MODEL_RENDER_PIPELINE_VERSION,
  WHITE_MODEL_RENDER_PROMPT_VERSION,
  WHITE_MODEL_RENDER_PROVIDER,
} from "@newworkflow/backend-shared";
import type { FilesRepository } from "../../../../api/src/modules/files/files.repository.types.ts";
import type {
  IntermediateArtifactType,
} from "@newworkflow/backend-shared";
import type {
  IntermediateArtifactRepository,
  IntermediateArtifactQuery,
  IntermediateArtifactRecord,
} from "./intermediate-artifact.repository.types.ts";
import {
  IntermediateLockService,
} from "./intermediate-lock.service.ts";

export interface IntermediateArtifactReservation {
  cacheKey: string;
  artifactType: IntermediateArtifactType;
  record: IntermediateArtifactRecord;
  sourceBlobId: string;
  status: "ready" | "processing";
  reusedFileId: string | null;
  release(): Promise<void>;
}

export interface WhiteModelIntermediateStatus {
  lineart: IntermediateArtifactReservation | null;
  depth: IntermediateArtifactReservation | null;
}

interface PendingArtifactResolution {
  promise: Promise<IntermediateArtifactRecord>;
  reject(error: unknown): void;
  resolve(record: IntermediateArtifactRecord): void;
}

function createPendingArtifactResolution(): PendingArtifactResolution {
  let resolve!: (record: IntermediateArtifactRecord) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<IntermediateArtifactRecord>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

export class IntermediateArtifactService {
  private readonly repository: IntermediateArtifactRepository;
  private readonly filesRepository: FilesRepository;
  private readonly waitRetryDelayMs: number;
  private readonly waitTimeoutMs: number;
  private readonly pendingArtifacts = new Map<string, PendingArtifactResolution>();

  constructor(
    repository: IntermediateArtifactRepository,
    filesRepository: FilesRepository,
    _lockService: IntermediateLockService,
    options?: {
      waitRetryDelayMs?: number;
      waitTimeoutMs?: number;
    },
  ) {
    this.repository = repository;
    this.filesRepository = filesRepository;
    this.waitRetryDelayMs = options?.waitRetryDelayMs ?? 100;
    this.waitTimeoutMs = options?.waitTimeoutMs ?? 300_000;
  }

  async resolveWhiteModelArtifacts(input: {
    whiteModelFileId: string;
    taskId: string | null;
    model: string;
    imageSize?: string | null;
    aspectRatio?: string | null;
  }): Promise<WhiteModelIntermediateStatus> {
    const whiteModelFile = await this.filesRepository.findFileById(input.whiteModelFileId);

    if (!whiteModelFile?.blobId) {
      throw new Error(`WHITE_MODEL_BLOB_NOT_FOUND:${input.whiteModelFileId}`);
    }

    const lineart = await this.acquireArtifact({
      sourceBlobId: whiteModelFile.blobId,
      artifactType: "lineart",
      lastTaskId: input.taskId,
      model: input.model,
      imageSize: input.imageSize,
      aspectRatio: input.aspectRatio,
    });
    const depth = await this.acquireArtifact({
      sourceBlobId: whiteModelFile.blobId,
      artifactType: "depth",
      lastTaskId: input.taskId,
      model: input.model,
      imageSize: input.imageSize,
      aspectRatio: input.aspectRatio,
    });

    return {
      lineart,
      depth,
    };
  }

  async acquireArtifact(input: {
    sourceBlobId: string;
    artifactType: IntermediateArtifactType;
    lastTaskId: string | null;
    model?: string | null;
    imageSize?: string | null;
    aspectRatio?: string | null;
  }): Promise<IntermediateArtifactReservation> {
    const query = this.buildQuery(input);
    const cacheKey = this.buildCacheKey(query);
    const existing = await this.repository.findByKey(query);

    if (existing?.status === "ready" && existing.fileId) {
      await this.repository.touchLastUsed(existing.id);

      return this.createReadyReservation(
        cacheKey,
        input.sourceBlobId,
        input.artifactType,
        existing,
      );
    }

    const pendingResolution = this.pendingArtifacts.get(cacheKey);

    if (pendingResolution) {
      const readyRecord = await this.waitForPendingArtifact(cacheKey, pendingResolution.promise);

      return this.createReadyReservation(
        cacheKey,
        input.sourceBlobId,
        input.artifactType,
        readyRecord,
      );
    }

    const { record, owner } = await this.repository.findOrCreateProcessing(
      query,
      input.lastTaskId,
    );

    if (record.status === "ready" && record.fileId) {
      await this.repository.touchLastUsed(record.id);

      return this.createReadyReservation(
        cacheKey,
        input.sourceBlobId,
        input.artifactType,
        record,
      );
    }

    if (owner) {
      if (!this.pendingArtifacts.has(cacheKey)) {
        this.pendingArtifacts.set(cacheKey, createPendingArtifactResolution());
      }

      return this.createReservation({
        cacheKey,
        sourceBlobId: input.sourceBlobId,
        artifactType: input.artifactType,
        record,
        status: "processing",
        reusedFileId: null,
      });
    }

    const localPendingResolution = this.pendingArtifacts.get(cacheKey);

    if (localPendingResolution) {
      const readyRecord = await this.waitForPendingArtifact(
        cacheKey,
        localPendingResolution.promise,
      );

      return this.createReadyReservation(
        cacheKey,
        input.sourceBlobId,
        input.artifactType,
        readyRecord,
      );
    }

    return await this.waitForReadyReservation({
      cacheKey,
      query,
      sourceBlobId: input.sourceBlobId,
      artifactType: input.artifactType,
    });
  }

  async markArtifactReady(input: {
    reservation: IntermediateArtifactReservation;
    fileId: string;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord> {
    const record = await this.repository.markReady({
      id: input.reservation.record.id,
      fileId: input.fileId,
      lastTaskId: input.lastTaskId,
    });

    this.resolvePendingArtifact(input.reservation.cacheKey, record);
    return record;
  }

  async markArtifactFailed(input: {
    reservation: IntermediateArtifactReservation;
    lastTaskId: string | null;
  }): Promise<IntermediateArtifactRecord> {
    const record = await this.repository.markFailed({
      id: input.reservation.record.id,
      lastTaskId: input.lastTaskId,
    });

    this.rejectPendingArtifact(
      input.reservation.cacheKey,
      new Error(`INTERMEDIATE_ARTIFACT_UNAVAILABLE:${input.reservation.cacheKey}`),
    );
    return record;
  }

  private buildQuery(input: {
    sourceBlobId: string;
    artifactType: IntermediateArtifactType;
    model?: string | null;
    imageSize?: string | null;
    aspectRatio?: string | null;
  }): IntermediateArtifactQuery {
    return {
      sourceBlobId: input.sourceBlobId,
      artifactType: input.artifactType,
      provider: WHITE_MODEL_RENDER_PROVIDER,
      model: input.model ?? WHITE_MODEL_RENDER_DEFAULT_MODEL,
      pipelineVersion: WHITE_MODEL_RENDER_PIPELINE_VERSION,
      promptVersion: WHITE_MODEL_RENDER_PROMPT_VERSION,
      imageSize: input.imageSize ?? null,
      aspectRatio: input.aspectRatio ?? null,
    };
  }

  private buildCacheKey(query: IntermediateArtifactQuery): string {
    return [
      query.sourceBlobId,
      query.artifactType,
      query.pipelineVersion,
      query.promptVersion,
      query.provider,
      query.model,
      query.imageSize ?? "none",
      query.aspectRatio ?? "none",
    ].join(":");
  }

  private createReservation(input: {
    cacheKey: string;
    sourceBlobId: string;
    artifactType: IntermediateArtifactType;
    record: IntermediateArtifactRecord;
    status: "ready" | "processing";
    reusedFileId: string | null;
  }): IntermediateArtifactReservation {
    return {
      cacheKey: input.cacheKey,
      artifactType: input.artifactType,
      record: input.record,
      sourceBlobId: input.sourceBlobId,
      status: input.status,
      reusedFileId: input.reusedFileId,
      release: async () => undefined,
    };
  }

  private createReadyReservation(
    cacheKey: string,
    sourceBlobId: string,
    artifactType: IntermediateArtifactType,
    record: IntermediateArtifactRecord,
  ): IntermediateArtifactReservation {
    return this.createReservation({
      cacheKey,
      sourceBlobId,
      artifactType,
      record,
      status: "ready",
      reusedFileId: record.fileId,
    });
  }

  private async waitForPendingArtifact(
    cacheKey: string,
    pendingPromise: Promise<IntermediateArtifactRecord>,
  ): Promise<IntermediateArtifactRecord> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`INTERMEDIATE_ARTIFACT_WAIT_TIMEOUT:${cacheKey}`));
      }, this.waitTimeoutMs);

      void pendingPromise.finally(() => {
        clearTimeout(timeoutHandle);
      });
    });

    const record = await Promise.race([
      pendingPromise,
      timeoutPromise,
    ]);

    if (record.status !== "ready" || !record.fileId) {
      throw new Error(`INTERMEDIATE_ARTIFACT_UNAVAILABLE:${cacheKey}`);
    }

    await this.repository.touchLastUsed(record.id);
    return record;
  }

  private async waitForReadyReservation(input: {
    cacheKey: string;
    query: IntermediateArtifactQuery;
    sourceBlobId: string;
    artifactType: IntermediateArtifactType;
  }): Promise<IntermediateArtifactReservation> {
    const startedAt = Date.now();

    while (true) {
      const existing = await this.repository.findByKey(input.query);

      if (existing?.status === "ready" && existing.fileId) {
        await this.repository.touchLastUsed(existing.id);

        return this.createReservation({
          cacheKey: input.cacheKey,
          sourceBlobId: input.sourceBlobId,
          artifactType: input.artifactType,
          record: existing,
          status: "ready",
          reusedFileId: existing.fileId,
        });
      }

      if (!existing || existing.status === "failed") {
        throw new Error(`INTERMEDIATE_ARTIFACT_UNAVAILABLE:${input.cacheKey}`);
      }

      if (Date.now() - startedAt >= this.waitTimeoutMs) {
        throw new Error(`INTERMEDIATE_ARTIFACT_WAIT_TIMEOUT:${input.cacheKey}`);
      }

      await this.delay(this.waitRetryDelayMs);
    }
  }

  private resolvePendingArtifact(
    cacheKey: string,
    record: IntermediateArtifactRecord,
  ): void {
    const pendingResolution = this.pendingArtifacts.get(cacheKey);

    if (!pendingResolution) {
      return;
    }

    this.pendingArtifacts.delete(cacheKey);
    pendingResolution.resolve(record);
  }

  private rejectPendingArtifact(cacheKey: string, error: unknown): void {
    const pendingResolution = this.pendingArtifacts.get(cacheKey);

    if (!pendingResolution) {
      return;
    }

    this.pendingArtifacts.delete(cacheKey);
    pendingResolution.reject(error);
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
