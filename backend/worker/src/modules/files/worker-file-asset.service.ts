import type {
  FileSourceType,
  FileType,
} from "@newworkflow/backend-shared";
import type { FilesRepository } from "../../../../api/src/modules/files/files.repository.types.ts";
import type { StorageWriteResult } from "../storage/storage.types.ts";

export interface RegisterWorkerAssetInput {
  userId: string | null;
  stored: StorageWriteResult;
  content: Buffer | string;
  fileType?: FileType;
  sourceType?: FileSourceType;
  duration?: number | null;
}

export class WorkerFileAssetService {
  private readonly filesRepository: FilesRepository;

  constructor(filesRepository: FilesRepository) {
    this.filesRepository = filesRepository;
  }

  async registerStoredAsset(input: RegisterWorkerAssetInput): Promise<string> {
    const registerResult = await this.filesRepository.registerFile({
      userId: input.userId ?? undefined,
      sha256: input.stored.sha256,
      size: input.stored.size,
      mimeType: input.stored.mimeType,
      originalName: input.stored.originalName,
      fileType: input.fileType ?? input.stored.fileType,
      sourceType: input.sourceType ?? input.stored.sourceType,
      duration: input.duration ?? undefined,
    });

    if (registerResult.uploadRequired && registerResult.uploadId) {
      await this.filesRepository.uploadFile(
        registerResult.uploadId,
        this.normalizeContent(input.content),
      );
    }

    return registerResult.file.fileId;
  }

  private normalizeContent(content: Buffer | string): string {
    return Buffer.isBuffer(content) ? content.toString("base64") : content;
  }
}
