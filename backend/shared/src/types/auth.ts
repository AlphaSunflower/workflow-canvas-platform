export type AccountRole = "member" | "admin";

export type AccountStatus = "enabled" | "disabled";

export type RefreshSessionStatus = "active" | "rotated" | "revoked" | "expired";

export interface BaseTokenPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AccessTokenPayload extends BaseTokenPayload {
  typ: "access";
  role: AccountRole;
  status: AccountStatus;
}

export interface RefreshTokenPayload extends BaseTokenPayload {
  typ: "refresh";
}
