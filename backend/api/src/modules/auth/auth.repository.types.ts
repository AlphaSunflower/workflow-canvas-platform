import type {
  AccountRole,
  AccountStatus,
  RefreshSessionStatus,
} from "@newworkflow/backend-shared/auth";

export interface AccountUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  status: RefreshSessionStatus;
  issuedAt: string;
  expiresAt: string;
  rotatedFromSessionId: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface AuditLogRecord {
  id: string;
  actorUserId: string | null;
  actorRole: AccountRole | null;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface AccountsStore {
  users: AccountUserRecord[];
  sessions: AccountSessionRecord[];
  auditLogs: AuditLogRecord[];
}

export interface EnsureBootstrapAdminInput {
  email: string;
  password: string;
  displayName: string;
}

export interface CreateAccountInput {
  email: string;
  passwordHash: string;
  displayName: string;
  role: AccountRole;
  status?: AccountStatus;
}

export interface UpdateAccountInput {
  email?: string;
  displayName?: string;
  passwordHash?: string;
  role?: AccountRole;
  status?: AccountStatus;
  lastLoginAt?: string | null;
}

export interface AccountRepository {
  ensureInitialized(): Promise<void>;
  ensureBootstrapAdmin(input: EnsureBootstrapAdminInput): Promise<AccountUserRecord>;
  createUser(input: CreateAccountInput): Promise<AccountUserRecord>;
  findUserById(userId: string): Promise<AccountUserRecord | null>;
  findUserByEmail(email: string): Promise<AccountUserRecord | null>;
  listUsers(): Promise<AccountUserRecord[]>;
  updateUser(userId: string, input: UpdateAccountInput): Promise<AccountUserRecord>;
}

export interface CreateSessionInput {
  sessionId?: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  rotatedFromSessionId?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface RotateSessionInput extends CreateSessionInput {
  sessionId: string;
  previousSessionId: string;
}

export interface SessionRepository {
  ensureInitialized(): Promise<void>;
  createSession(input: CreateSessionInput): Promise<AccountSessionRecord>;
  rotateSession(input: RotateSessionInput): Promise<{
    previousSession: AccountSessionRecord;
    nextSession: AccountSessionRecord;
  }>;
  findSessionById(sessionId: string): Promise<AccountSessionRecord | null>;
  findSessionByTokenHash(tokenHash: string): Promise<AccountSessionRecord | null>;
  listSessionsByUserId(userId: string): Promise<AccountSessionRecord[]>;
  updateSessionStatus(
    sessionId: string,
    status: RefreshSessionStatus,
    options?: {
      revokedAt?: string | null;
      revokedReason?: string | null;
    },
  ): Promise<AccountSessionRecord>;
  revokeSession(sessionId: string, revokedReason?: string): Promise<AccountSessionRecord>;
  revokeSessionsByUserId(userId: string, revokedReason?: string): Promise<number>;
}

export interface CreateAuditLogInput {
  actorUserId?: string | null;
  actorRole?: AccountRole | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface AuditRepository {
  ensureInitialized(): Promise<void>;
  createAuditLog(input: CreateAuditLogInput): Promise<AuditLogRecord>;
  listAuditLogs(limit?: number): Promise<AuditLogRecord[]>;
  listAuditLogsByTargetId(targetId: string, limit?: number): Promise<AuditLogRecord[]>;
}
