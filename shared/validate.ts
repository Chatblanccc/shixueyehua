import { AVATAR_PRESETS, USER_IDENTITIES, USER_ROLES, USER_STATUSES } from './domain';
import type {
  ClassOption,
  CurrentClass,
  CursorPage,
  GradeOption,
  LoginResult,
  OnboardingStep,
  SchoolOption,
  UserProfile,
} from './domain';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readString(value: unknown, maximum = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error('Invalid string');
  }
  return value;
}

export function readEnum<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.some((option) => option === value)) {
    throw new Error('Invalid enum');
  }
  return value as T;
}

function readISODate(value: unknown): string {
  const text = readString(value, 30);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error('Invalid timestamp');
  }
  return text;
}

export function parseUserProfile(value: unknown): UserProfile {
  if (!isRecord(value)) throw new Error('Invalid profile');
  const profile: UserProfile = {
    _id: readString(value._id),
    nickname: readString(value.nickname, 80),
    role: readEnum(value.role, USER_ROLES),
    status: readEnum(value.status, USER_STATUSES),
    createdAt: readISODate(value.createdAt),
    updatedAt: readISODate(value.updatedAt),
  };
  if (value.identity !== undefined) profile.identity = readEnum(value.identity, USER_IDENTITIES);
  if (value.avatarPreset !== undefined)
    profile.avatarPreset = readEnum(value.avatarPreset, AVATAR_PRESETS);
  for (const field of [
    'avatarFileId',
    'adminSchoolId',
    'currentSchoolId',
    'currentGradeId',
    'currentClassId',
  ] as const) {
    if (value[field] !== undefined)
      profile[field] = readString(value[field], field === 'avatarFileId' ? 1024 : 128);
  }
  return profile;
}

export function getOnboardingStep(
  user: Pick<UserProfile, 'identity' | 'currentSchoolId' | 'currentGradeId' | 'currentClassId'>,
): OnboardingStep {
  if (!user.identity) return 'identity';
  if (!user.currentSchoolId || !user.currentGradeId || !user.currentClassId) return 'class';
  return 'ready';
}

export function parseLoginResult(value: unknown): LoginResult {
  if (!isRecord(value)) throw new Error('Invalid login response');
  const user = parseUserProfile(value.user);
  const onboardingStep = readEnum(value.onboardingStep, ['identity', 'class', 'ready']);
  if (getOnboardingStep(user) !== onboardingStep) throw new Error('Inconsistent onboarding state');
  return { user, onboardingStep };
}

function schoolOption(value: unknown): SchoolOption {
  if (!isRecord(value)) throw new Error('Invalid school');
  return { _id: readString(value._id), name: readString(value.name, 120) };
}
function gradeOption(value: unknown): GradeOption {
  if (!isRecord(value)) throw new Error('Invalid grade');
  return { ...schoolOption(value), schoolId: readString(value.schoolId) };
}
function classOption(value: unknown): ClassOption {
  if (!isRecord(value)) throw new Error('Invalid class');
  return {
    ...gradeOption(value),
    gradeId: readString(value.gradeId),
    joinMode: readEnum(value.joinMode, ['free']),
  };
}
function page<T>(value: unknown, parse: (item: unknown) => T): CursorPage<T> {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 100)
    throw new Error('Invalid directory page');
  const result: CursorPage<T> = { items: value.items.map(parse) };
  if (value.nextCursor !== undefined) result.nextCursor = readString(value.nextCursor, 1024);
  return result;
}
export function parseSchoolPage(value: unknown): CursorPage<SchoolOption> {
  return page(value, schoolOption);
}
export function parseGradePage(value: unknown): CursorPage<GradeOption> {
  return page(value, gradeOption);
}
export function parseClassPage(value: unknown): CursorPage<ClassOption> {
  return page(value, classOption);
}
export function parseCurrentClass(value: unknown): CurrentClass | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Invalid current class');
  const result = {
    school: schoolOption(value.school),
    grade: gradeOption(value.grade),
    class: classOption(value.class),
  };
  if (
    result.grade.schoolId !== result.school._id ||
    result.class.schoolId !== result.school._id ||
    result.class.gradeId !== result.grade._id
  )
    throw new Error('Inconsistent class hierarchy');
  return result;
}
