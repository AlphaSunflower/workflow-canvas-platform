import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type {
  AccessTokenPayload,
  AccountRole,
  AccountStatus,
  RefreshTokenPayload,
} from "@newworkflow/backend-shared/auth";

type TokenKind = "access" | "refresh";

interface JwtHeader {
  alg: "HS256";
  typ: "JWT";
}

interface SignBaseInput {
  userId: string;
  issuedAt?: number;
  tokenId?: string;
}

export interface SignAccessTokenInput extends SignBaseInput {
  role: AccountRole;
  status: AccountStatus;
}

export interface SignRefreshTokenInput extends SignBaseInput {}

export interface TokenServiceOptions {
  issuer: string;
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenSecret: string;
  refreshTokenTtlSeconds: number;
}

function assertSecret(secret: string, field: string): string {
  if (!secret.trim()) {
    throw new Error(`${field.toUpperCase()}_REQUIRED`);
  }

  return secret;
}

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

function parseJwtHeader(segment: string): JwtHeader {
  const parsed = JSON.parse(decodeBase64Url(segment).toString("utf8")) as Partial<JwtHeader>;

  if (parsed.alg !== "HS256" || parsed.typ !== "JWT") {
    throw new Error("TOKEN_HEADER_INVALID");
  }

  return parsed as JwtHeader;
}

function parsePayload<TPayload>(segment: string): TPayload {
  return JSON.parse(decodeBase64Url(segment).toString("utf8")) as TPayload;
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function assertBasePayloadShape(
  payload: Partial<AccessTokenPayload | RefreshTokenPayload>,
  issuer: string,
  expectedType: TokenKind,
  nowSeconds: number,
): void {
  if (payload.iss !== issuer) {
    throw new Error("TOKEN_ISSUER_INVALID");
  }

  if (payload.typ !== expectedType) {
    throw new Error("TOKEN_TYPE_INVALID");
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("TOKEN_SUBJECT_INVALID");
  }

  if (typeof payload.jti !== "string" || !payload.jti) {
    throw new Error("TOKEN_ID_INVALID");
  }

  if (!isFinitePositiveInteger(payload.iat) || !isFinitePositiveInteger(payload.exp)) {
    throw new Error("TOKEN_TIME_INVALID");
  }

  if (payload.exp <= nowSeconds) {
    throw new Error("TOKEN_EXPIRED");
  }
}

function assertAccessPayloadShape(
  payload: Partial<AccessTokenPayload>,
  issuer: string,
  nowSeconds: number,
): asserts payload is AccessTokenPayload {
  assertBasePayloadShape(payload, issuer, "access", nowSeconds);

  if (payload.role !== "member" && payload.role !== "admin") {
    throw new Error("TOKEN_ROLE_INVALID");
  }

  if (payload.status !== "enabled" && payload.status !== "disabled") {
    throw new Error("TOKEN_STATUS_INVALID");
  }
}

function assertRefreshPayloadShape(
  payload: Partial<RefreshTokenPayload>,
  issuer: string,
  nowSeconds: number,
): asserts payload is RefreshTokenPayload {
  assertBasePayloadShape(payload, issuer, "refresh", nowSeconds);
}

export class TokenService {
  private readonly issuer: string;
  private readonly accessTokenSecret: string;
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenSecret: string;
  private readonly refreshTokenTtlSeconds: number;

  constructor(options: TokenServiceOptions) {
    this.issuer = options.issuer.trim() || "newworkflow-backend";
    this.accessTokenSecret = assertSecret(options.accessTokenSecret, "access_token_secret");
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.refreshTokenSecret = assertSecret(options.refreshTokenSecret, "refresh_token_secret");
    this.refreshTokenTtlSeconds = options.refreshTokenTtlSeconds;
  }

  signAccessToken(input: SignAccessTokenInput): { token: string; payload: AccessTokenPayload } {
    const issuedAt = input.issuedAt ?? this.nowSeconds();
    const payload: AccessTokenPayload = {
      typ: "access",
      iss: this.issuer,
      sub: input.userId,
      role: input.role,
      status: input.status,
      iat: issuedAt,
      exp: issuedAt + this.accessTokenTtlSeconds,
      jti: input.tokenId ?? randomUUID(),
    };

    return {
      token: this.signToken(payload, this.accessTokenSecret),
      payload,
    };
  }

  signRefreshToken(input: SignRefreshTokenInput): { token: string; payload: RefreshTokenPayload } {
    const issuedAt = input.issuedAt ?? this.nowSeconds();
    const payload: RefreshTokenPayload = {
      typ: "refresh",
      iss: this.issuer,
      sub: input.userId,
      iat: issuedAt,
      exp: issuedAt + this.refreshTokenTtlSeconds,
      jti: input.tokenId ?? randomUUID(),
    };

    return {
      token: this.signToken(payload, this.refreshTokenSecret),
      payload,
    };
  }

  verifyAccessToken(token: string, nowSeconds = this.nowSeconds()): AccessTokenPayload {
    const payload = this.verifyToken<AccessTokenPayload>(
      token,
      this.accessTokenSecret,
      "access",
      nowSeconds,
    );
    assertAccessPayloadShape(payload, this.issuer, nowSeconds);
    return payload;
  }

  verifyRefreshToken(token: string, nowSeconds = this.nowSeconds()): RefreshTokenPayload {
    const payload = this.verifyToken<RefreshTokenPayload>(
      token,
      this.refreshTokenSecret,
      "refresh",
      nowSeconds,
    );
    assertRefreshPayloadShape(payload, this.issuer, nowSeconds);
    return payload;
  }

  private signToken(
    payload: AccessTokenPayload | RefreshTokenPayload,
    secret: string,
  ): string {
    const header: JwtHeader = {
      alg: "HS256",
      typ: "JWT",
    };
    const encodedHeader = encodeBase64Url(JSON.stringify(header));
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const data = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", secret).update(data).digest();

    return `${data}.${encodeBase64Url(signature)}`;
  }

  private verifyToken<TPayload>(
    token: string,
    secret: string,
    expectedType: TokenKind,
    nowSeconds: number,
  ): TPayload {
    const segments = token.split(".");

    if (segments.length !== 3) {
      throw new Error("TOKEN_FORMAT_INVALID");
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    parseJwtHeader(encodedHeader);

    const data = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac("sha256", secret).update(data).digest();
    const actualSignature = decodeBase64Url(encodedSignature);

    if (
      actualSignature.length !== expectedSignature.length
      || !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw new Error("TOKEN_SIGNATURE_INVALID");
    }

    const payload = parsePayload<TPayload & { typ?: TokenKind }>(encodedPayload);

    if (payload.typ !== expectedType) {
      throw new Error("TOKEN_TYPE_INVALID");
    }

    assertBasePayloadShape(
      payload as Partial<AccessTokenPayload | RefreshTokenPayload>,
      this.issuer,
      expectedType,
      nowSeconds,
    );

    return payload as TPayload;
  }

  private nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}
