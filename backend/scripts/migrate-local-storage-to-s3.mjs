import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, "..");

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return null;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_REQUIRED`);
  }
  return value;
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function toAmzDate(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    scopeDate: iso.slice(0, 8),
  };
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeStorageKey(storageKey) {
  return storageKey.split("/").map(encodePathSegment).join("/");
}

function buildObjectUrl(config, storageKey) {
  const encodedKey = encodeStorageKey(storageKey);
  const url = new URL(config.endpoint);

  if (config.forcePathStyle) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodePathSegment(config.bucket)}/${encodedKey}`;
    return url;
  }

  url.hostname = `${config.bucket}.${url.hostname}`;
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodedKey}`;
  return url;
}

function sign(config, input) {
  const credentialScope = `${input.scopeDate}/${config.region}/s3/aws4_request`;
  const canonicalHeaders = [...input.headers.entries()]
    .map(([name, value]) => [name.toLowerCase(), value.trim()])
    .sort(([left], [right]) => left.localeCompare(right));
  const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
  const canonicalRequest = [
    input.method,
    input.pathname,
    "",
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
  const dateKey = hmac(`AWS4${config.secretAccessKey}`, input.scopeDate);
  const dateRegionKey = hmac(dateKey, config.region);
  const dateRegionServiceKey = hmac(dateRegionKey, "s3");
  const signingKey = hmac(dateRegionServiceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return [
    "AWS4-HMAC-SHA256",
    `Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");
}

async function putObject(config, storageKey, buffer) {
  const url = buildObjectUrl(config, storageKey);
  const { amzDate, scopeDate } = toAmzDate(new Date());
  const payloadHash = sha256Hex(buffer);
  const headers = new Headers({
    host: url.host,
    "content-length": String(buffer.length),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  });
  headers.set("authorization", sign(config, {
    method: "PUT",
    pathname: url.pathname,
    headers,
    payloadHash,
    amzDate,
    scopeDate,
  }));

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: buffer,
  });

  if (!response.ok) {
    throw new Error(`S3_PUT_FAILED:${response.status}:${await response.text()}`);
  }
}

async function listFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function main() {
  const storageRoot = path.resolve(readArg("--source") ?? path.join(backendRoot, "storage"));
  const dryRun = !hasFlag("--apply");
  const config = {
    endpoint: readArg("--endpoint") ?? requiredEnv("BACKEND_S3_ENDPOINT"),
    region: readArg("--region") ?? process.env.BACKEND_S3_REGION?.trim() ?? "us-east-1",
    bucket: readArg("--bucket") ?? requiredEnv("BACKEND_S3_BUCKET"),
    accessKeyId: readArg("--access-key-id") ?? requiredEnv("BACKEND_S3_ACCESS_KEY_ID"),
    secretAccessKey: readArg("--secret-access-key") ?? requiredEnv("BACKEND_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: !hasFlag("--virtual-hosted-style"),
  };
  const files = await listFiles(storageRoot);
  const report = {
    source: storageRoot,
    bucket: config.bucket,
    endpoint: config.endpoint,
    dryRun,
    total: files.length,
    uploaded: 0,
    objects: [],
  };

  for (const filePath of files) {
    const relativeKey = path.relative(storageRoot, filePath).replaceAll("\\", "/");
    const buffer = await fs.readFile(filePath);
    const item = {
      storageKey: relativeKey,
      size: buffer.length,
      sha256: sha256Hex(buffer),
      uploaded: false,
    };

    if (!dryRun) {
      await putObject(config, relativeKey, buffer);
      item.uploaded = true;
      report.uploaded += 1;
    }

    report.objects.push(item);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`[migrate-local-storage-to-s3] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
