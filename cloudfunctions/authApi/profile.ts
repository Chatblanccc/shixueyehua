import { AVATAR_PRESETS, USER_IDENTITIES, readEnum } from '../../shared';
import type { LoginResult, UpdateProfileInput } from '../../shared';
import { requireActiveUser } from '../_shared/auth';
import { writeAudit } from '../_shared/audit';
import { AppError } from '../_shared/errors';
import type { Repository, UserPatch } from '../_shared/repository';
import { transactionUser } from '../_shared/user-transaction';
import { loginResult } from './login';
import { hierarchy, membershipId } from '../classApi/classes';

export function profileInput(payload: Record<string, unknown>): UpdateProfileInput {
  try {
    if (Object.keys(payload).some((key) => !['identity', 'nickname', 'avatarPreset'].includes(key)))
      throw new Error('Unknown field');
    const result: UpdateProfileInput = { identity: readEnum(payload.identity, USER_IDENTITIES) };
    if (payload.nickname !== undefined) {
      if (
        typeof payload.nickname !== 'string' ||
        payload.nickname.length > 80 ||
        [...payload.nickname].some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      )
        throw new Error('Invalid nickname');
      result.nickname = payload.nickname.trim() || '夜话听友';
    }
    if (payload.avatarPreset !== undefined)
      result.avatarPreset = readEnum(payload.avatarPreset, AVATAR_PRESETS);
    return result;
  } catch {
    throw new AppError('INVALID_ARGUMENT');
  }
}

export async function updateProfile(
  repository: Repository,
  openid: string,
  payload: Record<string, unknown>,
  now: Date,
  requestId: string,
): Promise<LoginResult> {
  const input = profileInput(payload);
  const initial = await requireActiveUser(repository, openid);
  return repository.runTransaction(async (transaction) => {
    const actor = await transactionUser(transaction, initial._id, openid);
    const patch: UserPatch = { identity: input.identity, updatedAt: now };
    if (input.nickname !== undefined) patch.nickname = input.nickname;
    if (input.avatarPreset !== undefined) patch.avatarPreset = input.avatarPreset;
    if (
      actor.identity === input.identity &&
      (input.nickname === undefined || input.nickname === actor.nickname) &&
      (input.avatarPreset === undefined || input.avatarPreset === actor.avatarPreset)
    )
      return loginResult(actor);
    if (
      actor.identity !== input.identity &&
      actor.currentSchoolId &&
      actor.currentGradeId &&
      actor.currentClassId &&
      (await hierarchy(transaction, {
        schoolId: actor.currentSchoolId,
        gradeId: actor.currentGradeId,
        classId: actor.currentClassId,
      }))
    ) {
      const membership = await transaction.findMembership(
        membershipId(actor._id, actor.currentClassId),
      );
      if (
        membership &&
        (membership.userId !== actor._id ||
          membership.classId !== actor.currentClassId ||
          membership.schoolId !== actor.currentSchoolId)
      )
        throw new Error('Membership identity mismatch');
      // Historical memberships retain the identity used in that class. Never invent a missing member here.
      if (membership?.status === 'active' && membership.deletedAt == null)
        await transaction.saveMembership(
          { ...membership, identity: input.identity, updatedAt: now },
          true,
        );
    }
    await transaction.patchUser(actor._id, patch);
    await writeAudit(transaction, {
      actor,
      action: 'profile_update',
      targetType: 'user',
      targetId: actor._id,
      before: { identity: actor.identity, avatarPreset: actor.avatarPreset },
      after: {
        identity: input.identity,
        avatarPreset: input.avatarPreset,
        nicknameChanged: input.nickname !== undefined && input.nickname !== actor.nickname,
      },
      requestId,
      now,
    });
    return loginResult({ ...actor, ...patch });
  });
}
