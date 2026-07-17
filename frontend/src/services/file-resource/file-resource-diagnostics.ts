import type { FileResourceDiagnosticsMetadata } from './file-resource.types';

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 512;
const MAX_DIAGNOSTIC_DETAIL_STRING_LENGTH = 1024;
const REDACTED_DIAGNOSTIC_VALUE = '[REDACTED]';

export interface FileResourceDiagnosticEvent extends FileResourceDiagnosticsMetadata {
  event: 'attempt' | 'source-attempt' | 'source-failed' | 'resolved' | 'failed';
  source?: string;
  message?: string;
  detail?: Record<string, unknown>;
  at: number;
}

class FileResourceDiagnostics {
  private readonly events: FileResourceDiagnosticEvent[] = [];

  recordAttempt(metadata: FileResourceDiagnosticsMetadata, detail?: Record<string, unknown>): void {
    this.events.push({
      ...metadata,
      event: 'attempt',
      detail: sanitizeDiagnosticDetail(detail),
      at: Date.now(),
    });
  }

  recordSourceAttempt(
    metadata: FileResourceDiagnosticsMetadata,
    source: string,
    detail?: Record<string, unknown>,
  ): void {
    this.events.push({
      ...metadata,
      event: 'source-attempt',
      source,
      detail: sanitizeDiagnosticDetail(detail),
      at: Date.now(),
    });
  }

  recordSourceFailed(
    metadata: FileResourceDiagnosticsMetadata,
    source: string,
    message: string,
    detail?: Record<string, unknown>,
  ): void {
    this.events.push({
      ...metadata,
      event: 'source-failed',
      source,
      message: createDiagnosticMessage(message),
      detail: sanitizeDiagnosticDetail(detail),
      at: Date.now(),
    });
  }

  recordResolved(metadata: FileResourceDiagnosticsMetadata, detail?: Record<string, unknown>): void {
    this.events.push({
      ...metadata,
      event: 'resolved',
      detail: sanitizeDiagnosticDetail(detail),
      at: Date.now(),
    });
  }

  recordFailed(metadata: FileResourceDiagnosticsMetadata, message: string): void {
    this.events.push({
      ...metadata,
      event: 'failed',
      message: createDiagnosticMessage(message),
      at: Date.now(),
    });
  }

  getEvents(): FileResourceDiagnosticEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events.length = 0;
  }
}

function createDiagnosticMessage(message: string): string {
  const safeMessage = redactSensitiveText(message);
  if (safeMessage.length <= MAX_DIAGNOSTIC_MESSAGE_LENGTH) {
    return safeMessage;
  }

  return `${safeMessage.slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH)}...`;
}

function sanitizeDiagnosticDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!detail) {
    return undefined;
  }

  return sanitizeDiagnosticValue(detail) as Record<string, unknown>;
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const safeText = redactSensitiveText(value);
    return safeText.length > MAX_DIAGNOSTIC_DETAIL_STRING_LENGTH
      ? `${safeText.slice(0, MAX_DIAGNOSTIC_DETAIL_STRING_LENGTH)}...`
      : safeText;
  }

  if (Array.isArray(value)) {
    if (depth >= 3) {
      return '[Array]';
    }

    return value.map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    if (depth >= 3) {
      return '[Object]';
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sanitizeDiagnosticValue(entryValue, depth + 1),
      ]),
    );
  }

  return value;
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_DIAGNOSTIC_VALUE}`)
    .replace(
      /("(?:accessToken|refreshToken|idToken|access_token|refresh_token|id_token|token|authorization)"\s*:\s*")([^"]*)(")/gi,
      `$1${REDACTED_DIAGNOSTIC_VALUE}$3`,
    )
    .replace(
      /('(?:accessToken|refreshToken|idToken|access_token|refresh_token|id_token|token|authorization)'\s*:\s*')([^']*)(')/gi,
      `$1${REDACTED_DIAGNOSTIC_VALUE}$3`,
    )
    .replace(
      /([?&](?:accessToken|refreshToken|idToken|access_token|refresh_token|id_token|token)=)[^&#"',}\[\]\s]+/gi,
      `$1${REDACTED_DIAGNOSTIC_VALUE}`,
    );
}

export const fileResourceDiagnostics = new FileResourceDiagnostics();
