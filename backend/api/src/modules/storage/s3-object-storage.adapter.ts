import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";

import type { ObjectStorageAdapter, ObjectStorageReadResult, ObjectStorageStreamResult } from "./object-storage.adapter.ts";

export interface S3ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

function normalizeStorageKey(storageKey: string): string {
  const normalized = storageKey.replaceAll("\\", "/");

  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => part === ".." || part.length === 0)
  ) {
    throw new Error("INVALID_STORAGE_KEY");
  }

  return normalized;
}

function sha256Hex(input: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function toAmzDate(date: Date): { amzDate: string; scopeDate: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    scopeDate: iso.slice(0, 8),
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeStorageKey(storageKey: string): string {
  return normalizeStorageKey(storageKey).split("/").map(encodePathSegment).join("/");
}

function getHeader(response: Response, name: string): string | null {
  return response.headers.get(name);
}

export class S3ObjectStorageAdapter implements ObjectStorageAdapter {
  readonly provider = "s3";

  private readonly endpoint: URL;
  private readonly region: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly forcePathStyle: boolean;

  constructor(config: S3ObjectStorageConfig) {
    this.endpoint = new URL(config.endpoint);
    this.region = config.region;
    this.bucket = config.bucket;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.forcePathStyle = config.forcePathStyle ?? true;
  }

  async write(storageKey: string, buffer: Buffer | Uint8Array): Promise<void> {
    const response = await this.request("PUT", storageKey, {
      body: Buffer.from(buffer),
    });

    if (!response.ok) {
      throw new Error(`S3_WRITE_FAILED:${response.status}:${await response.text()}`);
    }
  }

  async writeIfMissing(storageKey: string, buffer: Buffer | Uint8Array): Promise<void> {
    if (await this.exists(storageKey)) {
      return;
    }

    await this.write(storageKey, buffer);
  }

  async copyIfMissing(sourceStorageKey: string, targetStorageKey: string): Promise<void> {
    if (await this.exists(targetStorageKey)) {
      return;
    }

    const response = await this.request("PUT", targetStorageKey, {
      headers: {
        "x-amz-copy-source": `/${encodePathSegment(this.bucket)}/${encodeStorageKey(sourceStorageKey)}`,
      },
    });

    if (!response.ok) {
      throw new Error(`S3_COPY_FAILED:${response.status}:${await response.text()}`);
    }
  }

  async read(storageKey: string): Promise<ObjectStorageReadResult> {
    const response = await this.request("GET", storageKey);

    if (!response.ok) {
      throw new Error(`S3_READ_FAILED:${response.status}:${await response.text()}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      buffer,
      byteLength: buffer.length,
      storageKey: normalizeStorageKey(storageKey),
      lastModifiedAt: getHeader(response, "last-modified")
        ? new Date(getHeader(response, "last-modified")!).toISOString()
        : new Date().toISOString(),
    };
  }

  async readStream(storageKey: string): Promise<ObjectStorageStreamResult> {
    const response = await this.request("GET", storageKey);

    if (!response.ok) {
      throw new Error(`S3_READ_FAILED:${response.status}:${await response.text()}`);
    }

    const contentLength = getHeader(response, "content-length");
    const byteLength = contentLength ? Number(contentLength) : 0;
    const lastModifiedAt = getHeader(response, "last-modified")
      ? new Date(getHeader(response, "last-modified")!).toISOString()
      : new Date().toISOString();

    if (!response.body) {
      throw new Error("S3_READ_STREAM_NO_BODY");
    }

    const stream = Readable.fromWeb(response.body as any);

    return {
      stream,
      byteLength,
      storageKey: normalizeStorageKey(storageKey),
      lastModifiedAt,
    };
  }

  async exists(storageKey: string): Promise<boolean> {
    const response = await this.request("HEAD", storageKey);

    if (response.status === 404) {
      return false;
    }

    if (!response.ok) {
      throw new Error(`S3_HEAD_FAILED:${response.status}:${await response.text()}`);
    }

    return true;
  }

  async deleteIfExists(storageKey: string): Promise<void> {
    const response = await this.request("DELETE", storageKey);

    if (response.status === 404) {
      return;
    }

    if (!response.ok) {
      throw new Error(`S3_DELETE_FAILED:${response.status}:${await response.text()}`);
    }
  }

  private async request(
    method: "DELETE" | "GET" | "HEAD" | "PUT",
    storageKey: string,
    options: {
      body?: Buffer;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const url = this.buildObjectUrl(storageKey);
    const now = new Date();
    const { amzDate, scopeDate } = toAmzDate(now);
    const body = options.body;
    const payloadHash = body ? sha256Hex(body) : sha256Hex("");
    const headers = new Headers({
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    });

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers.set(name, value);
    }

    if (body) {
      headers.set("content-length", String(body.length));
    }

    const authorization = this.sign({
      method,
      pathname: url.pathname,
      query: url.searchParams,
      headers,
      payloadHash,
      amzDate,
      scopeDate,
    });
    headers.set("authorization", authorization);

    return fetch(url, {
      method,
      headers,
      body,
    });
  }

  private buildObjectUrl(storageKey: string): URL {
    const encodedKey = encodeStorageKey(storageKey);
    const url = new URL(this.endpoint.toString());

    if (this.forcePathStyle) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodePathSegment(this.bucket)}/${encodedKey}`;
      return url;
    }

    url.hostname = `${this.bucket}.${url.hostname}`;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodedKey}`;
    return url;
  }

  private sign(input: {
    method: string;
    pathname: string;
    query: URLSearchParams;
    headers: Headers;
    payloadHash: string;
    amzDate: string;
    scopeDate: string;
  }): string {
    const credentialScope = `${input.scopeDate}/${this.region}/s3/aws4_request`;
    const canonicalHeaders = [...input.headers.entries()]
      .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
    const canonicalQuery = [...input.query.entries()]
      .map(([name, value]) => `${encodePathSegment(name)}=${encodePathSegment(value)}`)
      .sort()
      .join("&");
    const canonicalRequest = [
      input.method,
      input.pathname,
      canonicalQuery,
      canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(""),
      signedHeaders,
      input.payloadHash,
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      input.amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const dateKey = hmac(`AWS4${this.secretAccessKey}`, input.scopeDate);
    const dateRegionKey = hmac(dateKey, this.region);
    const dateRegionServiceKey = hmac(dateRegionKey, "s3");
    const signingKey = hmac(dateRegionServiceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey)
      .update(stringToSign)
      .digest("hex");

    return [
      "AWS4-HMAC-SHA256",
      `Credential=${this.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", ");
  }
}
