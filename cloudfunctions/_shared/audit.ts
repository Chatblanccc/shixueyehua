import type { AdminLog, AuditSnapshot, ErrorCode, User } from '../../shared';
import { isRecord } from '../../shared';
import type { Repository } from './repository';

const SNAPSHOT_FIELDS = new Set([
  'role',
  'status',
  'identity',
  'avatarPreset',
  'nicknameChanged',
  'adminSchoolId',
  'currentSchoolId',
  'currentGradeId',
  'currentClassId',
  'reviewStatus',
  'visibility',
  'letterPublishMode',
  'enableLetterImages',
  'maxLetterImages',
  'reportAutoHideThreshold',
  'maintenanceMode',
  'joinMode',
  'deleted',
]);

/** Positive allowlist excludes body text, OpenID, contacts, URLs, tokens and arbitrary nested data. */
export function sanitizeAuditSnapshot(value: unknown): AuditSnapshot {
  if (!isRecord(value)) return {};
  const safe: AuditSnapshot = {};
  for (const [key, field] of Object.entries(value)) {
    if (!SNAPSHOT_FIELDS.has(key)) continue;
    if (field === null || typeof field === 'boolean') safe[key] = field;
    else if (typeof field === 'number' && Number.isFinite(field)) safe[key] = field;
    else if (typeof field === 'string' && /^[A-Za-z0-9_:-]{1,128}$/.test(field)) safe[key] = field;
  }
  return safe;
}

export interface AuditInput {
  actor: User;
  schoolId?: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  requestId: string;
  now: Date;
}

/** Future privileged writes must persist this log with their state transition atomically. */
export async function writeAudit(
  repository: Pick<Repository, 'appendAudit'>,
  input: AuditInput,
): Promise<void> {
  const entry: Omit<AdminLog, '_id'> = {
    operatorId: input.actor._id,
    operatorOpenid: input.actor.openid,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: sanitizeAuditSnapshot(input.before),
    after: sanitizeAuditSnapshot(input.after),
    requestId: input.requestId,
    createdAt: input.now,
  };
  if (input.schoolId !== undefined) entry.schoolId = input.schoolId;
  await repository.appendAudit(entry);
}

export interface RequestLog {
  requestId: string;
  domain: string;
  action: string;
  outcome: 'success' | 'failure';
  code?: ErrorCode;
}

export interface Logger {
  write(event: RequestLog): void;
}

/** Do not log raw events, SDK exceptions, stacks or user documents. */
export const consoleLogger: Logger = {
  write(event) {
    console.info(JSON.stringify(event));
  },
};
