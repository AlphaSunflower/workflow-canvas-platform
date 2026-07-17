import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  SAMPLE_PNG,
  bearer,
  cleanupDbE2EContext,
  closeDbApi,
  createDbE2EContext,
  registerAccount,
  requestBuffer,
  requestJson,
  startDbApi,
} from "./bootstrap-db.ts";

async function requestBinaryUpload<TResponse>(
  baseUrl: string,
  uploadId: string,
  buffer: Buffer,
  accessToken: string,
): Promise<{
  status: number;
  body: {
    code: number;
    data?: TResponse;
  };
}> {
  const response = await fetch(`${baseUrl}/api/v1/files/upload?uploadId=${encodeURIComponent(uploadId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });

  return {
    status: response.status,
    body: await response.json() as { code: number; data?: TResponse },
  };
}

async function exists(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then(
    () => true,
    () => false,
  );
}

async function run(): Promise<void> {
  const context = await createDbE2EContext("files_full");
  const api = await startDbApi(context);
  const legacyFilesStorePath = path.join(context.rootDir, "data", "files", "files-store.json");
  const legacyStorageIndexPath = path.join(context.rootDir, "data", "storage-index.json");

  try {
    await fs.rm(path.join(context.rootDir, "data"), { recursive: true, force: true });
    assert.equal(await exists(legacyFilesStorePath), false);
    assert.equal(await exists(legacyStorageIndexPath), false);

    const owner = await registerAccount(api.baseUrl, {
      email: "files-full-owner@example.com",
      password: "files-full-owner-pass",
      displayName: "Files Full Owner",
    });
    const other = await registerAccount(api.baseUrl, {
      email: "files-full-other@example.com",
      password: "files-full-other-pass",
      displayName: "Files Full Other",
    });

    const sha256 = createHash("sha256").update(SAMPLE_PNG).digest("hex");
    const registerResponse = await requestJson<{
      uploadRequired: boolean;
      uploadId?: string;
      fileId: string;
      file: {
        fileId: string;
        userId: string | null;
        status: string;
      };
    }>(api.baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        sha256,
        size: SAMPLE_PNG.length,
        mimeType: "image/png",
        originalName: "files-full.png",
        fileType: "image",
        sourceType: "input",
      },
    });
    assert.equal(registerResponse.status, 200);
    assert.equal(registerResponse.body.data?.uploadRequired, true);
    assert.ok(registerResponse.body.data?.uploadId);
    assert.equal(registerResponse.body.data?.file.userId, owner.userId);
    assert.equal(registerResponse.body.data?.file.status, "pending_upload");

    const forbiddenUpload = await requestBinaryUpload(
      api.baseUrl,
      registerResponse.body.data!.uploadId!,
      SAMPLE_PNG,
      other.accessToken,
    );
    assert.equal(forbiddenUpload.status, 403);

    const mismatch = await requestBinaryUpload(
      api.baseUrl,
      registerResponse.body.data!.uploadId!,
      Buffer.from("wrong-content"),
      owner.accessToken,
    );
    assert.equal(mismatch.status, 400);

    const uploadResponse = await requestBinaryUpload<{
      fileId: string;
      file: {
        fileId: string;
        blobId: string | null;
        status: string;
        downloadUrl?: string;
        previewUrl?: string;
        thumbnailUrl?: string;
      };
    }>(
      api.baseUrl,
      registerResponse.body.data!.uploadId!,
      SAMPLE_PNG,
      owner.accessToken,
    );
    assert.equal(uploadResponse.status, 200);
    assert.equal(uploadResponse.body.data?.file.status, "ready");
    assert.ok(uploadResponse.body.data?.file.blobId);
    assert.ok(uploadResponse.body.data?.file.downloadUrl);
    assert.ok(uploadResponse.body.data?.file.previewUrl);
    assert.ok(uploadResponse.body.data?.file.thumbnailUrl);
    const fileId = uploadResponse.body.data!.fileId;
    const blobId = uploadResponse.body.data!.file.blobId;

    const otherDetail = await requestJson(api.baseUrl, `/api/v1/files/${fileId}`, {
      headers: bearer(other.accessToken),
    });
    assert.equal(otherDetail.status, 403);

    const download = await requestBuffer(api.baseUrl, `/api/v1/files/${fileId}/download`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(download.status, 200);
    assert.equal(Buffer.compare(download.buffer, SAMPLE_PNG), 0);
    assert.match(download.headers.get("etag") ?? "", /^"/u);
    assert.match(download.headers.get("cache-control") ?? "", /private/u);

    const preview = await requestBuffer(api.baseUrl, `/api/v1/files/${fileId}/preview`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(preview.status, 200);
    assert.ok(preview.buffer.length > 0);
    assert.match(preview.headers.get("content-type") ?? "", /^image\//u);

    const thumbnail = await requestBuffer(api.baseUrl, `/api/v1/files/${fileId}/thumbnail`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(thumbnail.status, 200);
    assert.ok(thumbnail.buffer.length > 0);
    assert.match(thumbnail.headers.get("content-type") ?? "", /^image\//u);

    const otherDownload = await requestBuffer(api.baseUrl, `/api/v1/files/${fileId}/download`, {
      headers: bearer(other.accessToken),
    });
    assert.equal(otherDownload.status, 403);

    const dedupe = await requestJson<{
      uploadRequired: boolean;
      fileId: string;
      file: {
        fileId: string;
        blobId: string | null;
        userId: string | null;
      };
    }>(api.baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: bearer(other.accessToken),
      payload: {
        sha256,
        size: SAMPLE_PNG.length,
        mimeType: "image/png",
        originalName: "files-full-copy.png",
        fileType: "image",
        sourceType: "input",
      },
    });
    assert.equal(dedupe.status, 200);
    assert.equal(dedupe.body.data?.uploadRequired, false);
    assert.notEqual(dedupe.body.data?.fileId, fileId);
    assert.equal(dedupe.body.data?.file.blobId, blobId);
    assert.equal(dedupe.body.data?.file.userId, other.userId);

    const dbState = await context.pool.query<{
      blobs: number;
      assets: number;
      pending_assets: number;
      completed_uploads: number;
      failed_uploads: number;
      variants: number;
      events: number;
      owner_assets: number;
      other_assets: number;
    }>(
      `
        select
          (select count(*)::int from file_blobs) as blobs,
          (select count(*)::int from file_assets) as assets,
          (select count(*)::int from file_assets where status = 'pending_upload') as pending_assets,
          (select count(*)::int from file_uploads where status = 'completed') as completed_uploads,
          (select count(*)::int from file_uploads where status = 'failed') as failed_uploads,
          (select count(*)::int from file_blob_variants) as variants,
          (select count(*)::int from file_events) as events,
          (select count(*)::int from file_assets where user_id = $1) as owner_assets,
          (select count(*)::int from file_assets where user_id = $2) as other_assets
      `,
      [owner.userId, other.userId],
    );
    assert.equal(dbState.rows[0]?.blobs, 1);
    assert.equal(dbState.rows[0]?.assets, 2);
    assert.equal(dbState.rows[0]?.pending_assets, 0);
    assert.equal(dbState.rows[0]?.completed_uploads, 1);
    assert.equal(dbState.rows[0]?.failed_uploads, 0);
    assert.ok((dbState.rows[0]?.variants ?? 0) >= 3);
    assert.ok((dbState.rows[0]?.events ?? 0) >= 3);
    assert.equal(dbState.rows[0]?.owner_assets, 1);
    assert.equal(dbState.rows[0]?.other_assets, 1);

    const blobRows = await context.pool.query<{
      storage_key: string;
      preview_storage_key: string | null;
      thumbnail_storage_key: string | null;
    }>("select storage_key, preview_storage_key, thumbnail_storage_key from file_blobs where id = $1", [blobId]);
    const blob = blobRows.rows[0]!;
    assert.equal(await exists(path.join(context.rootDir, "storage", blob.storage_key)), true);
    assert.equal(await exists(path.join(context.rootDir, "storage", blob.preview_storage_key ?? "")), true);
    assert.equal(await exists(path.join(context.rootDir, "storage", blob.thumbnail_storage_key ?? "")), true);

    assert.equal(await exists(legacyFilesStorePath), false);
    assert.equal(await exists(legacyStorageIndexPath), false);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
