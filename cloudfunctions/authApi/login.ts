import { createHash } from 'node:crypto';
import { getOnboardingStep, parseUserProfile } from '../../shared';
import type { LoginResult, User, UserProfile } from '../../shared';
import { assertNotDeleted, requireLogin } from '../_shared/auth';
import type { Repository } from '../_shared/repository';

export function userDocumentId(openid: string): string {
  return `usr_${createHash('sha256').update(openid).digest('hex')}`;
}

export function toUserProfile(user: User): UserProfile {
  // The parser reconstructs a whitelist; adding a new DB field never exposes it implicitly.
  return parseUserProfile({
    ...user,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });
}

export function loginResult(user: User): LoginResult {
  assertNotDeleted(user);
  const profile = toUserProfile(user);
  return { user: profile, onboardingStep: getOnboardingStep(profile) };
}

export async function login(
  repository: Repository,
  openid: string,
  now: Date,
): Promise<LoginResult> {
  const existing = await repository.findUserByOpenid(openid);
  if (existing) return loginResult(existing);
  const user: User = {
    _id: userDocumentId(openid),
    openid,
    nickname: '夜话听友',
    role: 'user',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  try {
    // Atomic add + deterministic _id + unique openid index. Never overwrite an existing role/profile.
    await repository.insertUser(user);
  } catch (error: unknown) {
    // Handles concurrent unique conflicts and uncertain responses after a committed insert.
    // A real storage failure without a persisted user still fails; no mock success fallback.
    const winner = await repository.findUserByOpenid(openid);
    if (winner) return loginResult(winner);
    throw error;
  }
  return loginResult(user);
}

export async function getProfile(repository: Repository, openid: string): Promise<LoginResult> {
  return loginResult(await requireLogin(repository, openid));
}
