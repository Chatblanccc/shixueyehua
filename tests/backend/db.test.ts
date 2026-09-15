import { describe, expect, it, vi } from 'vitest';
import { CloudRepository, parseUserDocument } from '../../cloudfunctions/_shared/db';
import { user } from './fixtures';

function adapter(records: unknown[] = []) {
  const get = vi.fn(async (): Promise<unknown> => ({ data: records }));
  const limit = vi.fn(() => ({ get }));
  const where = vi.fn(() => ({ limit }));
  const add = vi.fn(async ({ data }: { data: object }): Promise<unknown> => ({
    _id: '_id' in data ? data._id : 'test_inserted_id',
  }));
  const collection = vi.fn(() => ({ where, add }));
  const repository = new CloudRepository(() => ({ collection }));
  return { repository, get, limit, where, add, collection };
}

describe('wx-server-sdk persistence adapter', () => {
  it('uses atomic add with a supplied document ID, never set/upsert', async () => {
    const { repository, add, collection } = adapter();
    const newUser = user();
    await repository.insertUser(newUser);
    expect(collection).toHaveBeenCalledWith('users');
    expect(add).toHaveBeenCalledWith({ data: newUser });
    expect(newUser.createdAt).toBeInstanceOf(Date);
  });

  it('queries by trusted OpenID and fails closed on duplicate persisted users', async () => {
    const existing = user();
    const { repository, where, limit } = adapter([existing]);
    expect(await repository.findUserByOpenid(existing.openid)).toEqual(existing);
    expect(where).toHaveBeenCalledWith({ openid: existing.openid });
    expect(limit).toHaveBeenCalledWith(2);
    await expect(
      adapter([existing, { ...existing, _id: 'test_duplicate' }]).repository.findUserByOpenid(
        existing.openid,
      ),
    ).rejects.toThrow('uniqueness');
  });

  it('validates external DB documents and refuses a mismatched queried identity', async () => {
    expect(() => parseUserDocument({ ...user(), role: 'owner' })).toThrow();
    expect(() => parseUserDocument({ ...user(), updatedAt: 'unvalidated-string' })).toThrow();
    await expect(
      adapter([user()]).repository.findUserByOpenid('test_other_identity'),
    ).rejects.toThrow('mismatch');
  });

  it('performs a real adapter database query for health without returning data', async () => {
    const { repository, collection, where, get } = adapter([{ privateField: 'not_returned' }]);
    expect(await repository.checkDatabase()).toBeUndefined();
    expect(collection).toHaveBeenCalledWith('system_configs');
    expect(where).toHaveBeenCalledWith({ _id: 'app:global' });
    expect(get).toHaveBeenCalledOnce();
  });

  it.each([undefined, {}, { _id: 'test_wrong_document' }, { _id: 'test_user', code: 'DENIED' }])(
    'rejects an unconfirmed login insert: %j',
    async (response) => {
      const { repository, add } = adapter();
      add.mockResolvedValue(response);
      await expect(repository.insertUser(user())).rejects.toThrow();
    },
  );

  it('refuses an invalid audit write acknowledgement', async () => {
    const { repository, add } = adapter();
    add.mockResolvedValue({});
    await expect(
      repository.appendAudit({
        operatorId: 'test_operator',
        operatorOpenid: 'test_operator_openid',
        action: 'test_action',
        targetType: 'user',
        targetId: 'test_target',
        before: {},
        after: {},
        requestId: 'test_request',
        createdAt: user().createdAt,
      }),
    ).rejects.toThrow();
  });

  it('does not turn an SDK error with attached data into a successful health probe', async () => {
    const { repository, get } = adapter();
    get.mockResolvedValue({ data: [], code: 'PERMISSION_DENIED' });
    await expect(repository.checkDatabase()).rejects.toThrow('Invalid database response');
  });
});
