import assert from "node:assert/strict";

import {
  SAMPLE_PNG,
  bearer,
  cleanupDbE2EContext,
  createDbE2EContext,
  registerAccount,
  requestBuffer,
  requestJson,
  startDbApi,
  closeDbApi,
} from "./bootstrap-db.ts";
import { createHash } from "node:crypto";

async function run(): Promise<void> {
  const context = await createDbE2EContext("files");
  const api = await startDbApi(context);

  try {
    const healthResponse = await fetch(`${api.baseUrl}/healthz`);
    const health = await healthResponse.json() as {
      status: string;
      persistenceMode: string;
      database: { status: string };
    };
    assert.equal(healthResponse.status, 200);
    assert.equal(health.persistenceMode, "db");
    assert.equal(health.database.status, "ok");

    const owner = await registerAccount(api.baseUrl, {
      email: "files-owner@example.com",
      password: "files-owner-pass",
      displayName: "Files Owner",
    });
    const other = await registerAccount(api.baseUrl, {
      email: "files-other@example.com",
      password: "files-other-pass",
      displayName: "Files Other",
    });

    const sha256 = createHash("sha256").update(SAMPLE_PNG).digest("hex");
    const registerResponse = await requestJson<{
      uploadRequired: boolean;
      uploadId?: string;
      fileId: string;
      file: {
        fileId: string;
        status: string;
      };
    }>(api.baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        sha256,
        size: SAMPLE_PNG.length,
        mimeType: "image/png",
        originalName: "db-e2e-source.png",
        fileType: "image",
        sourceType: "input",
      },
    });
    assert.equal(registerResponse.status, 200);
    assert.equal(registerResponse.body.data?.uploadRequired, true);
    assert.ok(registerResponse.body.data?.uploadId);
    assert.equal(registerResponse.body.data?.file.status, "pending_upload");

    const uploadResponse = await requestJson<{
      fileId: string;
      file: {
        fileId: string;
        blobId: string | null;
        status: string;
        previewUrl?: string;
        thumbnailUrl?: string;
        downloadUrl?: string;
      };
    }>(api.baseUrl, "/api/v1/files/upload", {
      method: "POST",
      headers: bearer(owner.accessToken),
      payload: {
        uploadId: registerResponse.body.data.uploadId,
        contentBase64: SAMPLE_PNG.toString("base64"),
      },
    });
    assert.equal(uploadResponse.status, 200);
    assert.equal(uploadResponse.body.data?.file.status, "ready");
    assert.ok(uploadResponse.body.data?.file.blobId);
    assert.ok(uploadResponse.body.data?.file.downloadUrl);
    assert.ok(uploadResponse.body.data?.file.previewUrl);
    assert.ok(uploadResponse.body.data?.file.thumbnailUrl);
    const fileId = uploadResponse.body.data!.fileId;
    const blobId = uploadResponse.body.data!.file.blobId;

    const detailResponse = await requestJson<{
      fileId: string;
      sha256: string;
      status: string;
    }>(api.baseUrl, `/api/v1/files/${fileId}`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(detailResponse.status, 200);
    assert.equal(detailResponse.body.data?.fileId, fileId);
    assert.equal(detailResponse.body.data?.sha256, sha256);
    assert.equal(detailResponse.body.data?.status, "ready");

    const forbidden = await requestJson(api.baseUrl, `/api/v1/files/${fileId}`, {
      headers: bearer(other.accessToken),
    });
    assert.equal(forbidden.status, 403);

    const download = await requestBuffer(api.baseUrl, `/api/v1/files/${fileId}/download`, {
      headers: bearer(owner.accessToken),
    });
    assert.equal(download.status, 200);
    assert.equal(Buffer.compare(download.buffer, SAMPLE_PNG), 0);
    assert.match(download.headers.get("etag") ?? "", /^"/u);
    assert.match(download.headers.get("cache-control") ?? "", /private/u);

    const notModified = await fetch(`${api.baseUrl}/api/v1/files/${fileId}/download`, {
      headers: {
        ...bearer(owner.accessToken),
        "If-None-Match": download.headers.get("etag") ?? "",
      },
    });
    assert.equal(notModified.status, 304);

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

    const dedupeRegister = await requestJson<{
      uploadRequired: boolean;
      fileId: string;
      file: {
        fileId: string;
        blobId: string | null;
      };
    }>(api.baseUrl, "/api/v1/files/register", {
      method: "POST",
      headers: bearer(other.accessToken),
      payload: {
        sha256,
        size: SAMPLE_PNG.length,
        mimeType: "image/png",
        originalName: "db-e2e-source-copy.png",
        fileType: "image",
        sourceType: "input",
      },
    });
    assert.equal(dedupeRegister.status, 200);
    assert.equal(dedupeRegister.body.data?.uploadRequired, false);
    assert.notEqual(dedupeRegister.body.data?.fileId, fileId);
    assert.equal(dedupeRegister.body.data?.file.blobId, blobId);

    const counts = await context.pool.query<{
      blobs: number;
      assets: number;
      variants: number;
      completed_uploads: number;
      events: number;
    }>(
      `
        select
          (select count(*)::int from file_blobs) as blobs,
          (select count(*)::int from file_assets) as assets,
          (select count(*)::int from file_blob_variants) as variants,
          (select count(*)::int from file_uploads where status = 'completed') as completed_uploads,
          (select count(*)::int from file_events) as events
      `,
    );
    assert.equal(counts.rows[0]?.blobs, 1);
    assert.equal(counts.rows[0]?.assets, 2);
    assert.equal(counts.rows[0]?.completed_uploads, 1);
    assert.ok((counts.rows[0]?.variants ?? 0) >= 3);
    assert.ok((counts.rows[0]?.events ?? 0) >= 3);
  } finally {
    await closeDbApi(api);
    await cleanupDbE2EContext(context);
  }
}

await run();
