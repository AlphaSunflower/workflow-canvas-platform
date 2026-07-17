import type {
  FileRegisterRequest,
  FileRegisterResponseData,
  FileUploadRequest,
  FileUploadResponseData,
} from "@newworkflow/backend-shared/api";
import type { AuthenticatedAccount } from "../auth/auth.service.ts";
import type {
  FilesRepository,
  FileContentReadResult,
  FileContentVariant,
} from "./files.repository.types.ts";

export interface FileResourceResponse extends FileContentReadResult {
  cacheControl: string;
  etag: string;
}

function canAccessOwnedResource(
  authenticated: AuthenticatedAccount,
  ownerUserId: string | null,
): boolean {
  if (authenticated.user.role === "admin") {
    return true;
  }

  return ownerUserId === authenticated.user.userId;
}

function getVariantCacheControl(variant: FileContentVariant): string {
  switch (variant) {
    case "thumbnail":
      return "private, max-age=300, stale-while-revalidate=86400";
    case "preview":
      return "private, max-age=120, stale-while-revalidate=3600";
    case "download":
      return "private, max-age=0, must-revalidate";
  }
}

function buildResourceEtag(fileId: string, variant: FileContentVariant, resource: FileContentReadResult): string {
  return `"${fileId}:${variant}:${resource.blobSha256}"`;
}

export class FilesService {
  private readonly repository: FilesRepository;

  constructor(repository: FilesRepository) {
    this.repository = repository;
  }

  async register(
    request: FileRegisterRequest,
  ): Promise<FileRegisterResponseData> {
    const result = await this.repository.registerFile(request);

    return {
      uploadRequired: result.uploadRequired,
      ...(result.uploadId ? { uploadId: result.uploadId } : {}),
      ...(result.uploadUrl ? { uploadUrl: result.uploadUrl } : {}),
      fileId: result.file.fileId,
      file: result.file,
    };
  }

  async registerForActor(
    authenticated: AuthenticatedAccount,
    request: FileRegisterRequest,
  ): Promise<FileRegisterResponseData> {
    return this.register({
      ...request,
      userId: authenticated.user.userId,
    });
  }

  async upload(request: FileUploadRequest): Promise<FileUploadResponseData> {
    const result = await this.repository.uploadFile(
      request.uploadId,
      Buffer.from(request.contentBase64, "base64"),
    );

    return {
      uploadId: result.uploadId,
      fileId: result.file.fileId,
      file: result.file,
    };
  }

  async uploadBinary(
    uploadId: string,
    buffer: Buffer | Uint8Array,
  ): Promise<FileUploadResponseData> {
    const result = await this.repository.uploadFile(uploadId, buffer);

    return {
      uploadId: result.uploadId,
      fileId: result.file.fileId,
      file: result.file,
    };
  }

  async uploadForActor(
    authenticated: AuthenticatedAccount,
    request: FileUploadRequest,
  ): Promise<FileUploadResponseData> {
    const pendingUpload = await this.repository.findPendingUploadById(request.uploadId);

    if (!pendingUpload) {
      throw new Error("UPLOAD_NOT_FOUND");
    }

    if (!canAccessOwnedResource(authenticated, pendingUpload.userId)) {
      throw new Error("UPLOAD_ACCESS_FORBIDDEN");
    }

    return this.upload(request);
  }

  async uploadBinaryForActor(
    authenticated: AuthenticatedAccount,
    uploadId: string,
    buffer: Buffer | Uint8Array,
  ): Promise<FileUploadResponseData> {
    const pendingUpload = await this.repository.findPendingUploadById(uploadId);

    if (!pendingUpload) {
      throw new Error("UPLOAD_NOT_FOUND");
    }

    if (!canAccessOwnedResource(authenticated, pendingUpload.userId)) {
      throw new Error("UPLOAD_ACCESS_FORBIDDEN");
    }

    return this.uploadBinary(uploadId, buffer);
  }

  async getFile(fileId: string) {
    return this.repository.findFileById(fileId);
  }

  async getFileForActor(
    authenticated: AuthenticatedAccount,
    fileId: string,
  ) {
    const fileRecord = await this.repository.findFileRecordById(fileId);

    if (!fileRecord) {
      return null;
    }

    if (!canAccessOwnedResource(authenticated, fileRecord.userId)) {
      throw new Error("FILE_ACCESS_FORBIDDEN");
    }

    return this.repository.findFileById(fileId);
  }

  async getFiles(fileIds: string[]) {
    return this.repository.findFilesByIds(fileIds);
  }

  async downloadFile(fileId: string) {
    return this.repository.readFileContent(fileId, "download");
  }

  async downloadFileForActor(
    authenticated: AuthenticatedAccount,
    fileId: string,
    variant: FileContentVariant = "download",
  ): Promise<FileResourceResponse | null> {
    const fileRecord = await this.repository.findFileRecordById(fileId);

    if (!fileRecord) {
      return null;
    }

    if (!canAccessOwnedResource(authenticated, fileRecord.userId)) {
      throw new Error("FILE_ACCESS_FORBIDDEN");
    }

    const resource = await this.repository.readFileContent(fileId, variant);
    if (!resource) {
      return null;
    }

    return {
      ...resource,
      cacheControl: getVariantCacheControl(variant),
      etag: buildResourceEtag(fileId, variant, resource),
    };
  }
}
