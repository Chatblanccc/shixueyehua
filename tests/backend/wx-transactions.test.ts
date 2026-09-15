import { createRequire } from 'node:module';
import cloud from 'wx-server-sdk';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../shared';
import { CloudRepository } from '../../cloudfunctions/_shared/db';
import { updateProfile } from '../../cloudfunctions/authApi/profile';
import { membershipId, selectClass } from '../../cloudfunctions/classApi/classes';
import { classroom, grade, NOW, school, user } from './fixtures';
import type { User } from '../../shared';

const runtimeRequire = createRequire(import.meta.url);
const wxRequire = createRequire(runtimeRequire.resolve('wx-server-sdk'));
const sdkRequire = createRequire(wxRequire.resolve('@cloudbase/node-sdk'));
cloud.init({ env: 'offline-transactions-only' });
cloud.database();
const databaseModule: unknown = sdkRequire('@cloudbase/database');
if (
  !isRecord(databaseModule) ||
  typeof databaseModule.Db !== 'function' ||
  !('reqClass' in databaseModule.Db)
)
  throw Error('Missing installed database transport');
const Db = databaseModule.Db;
const selection = { schoolId: 'test_school_a', gradeId: 'test_grade_a', classId: 'test_class_a' };
interface Call {
  action: string;
  parameters: Record<string, unknown>;
}
function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw Error('Expected fixture object');
  return value;
}
function encoded(entry: Record<string, unknown>): string {
  const value: Record<string, unknown> = { ...entry };
  for (const [key, field] of Object.entries(value))
    if (field instanceof Date) value[key] = { $date: field.toISOString() };
  return JSON.stringify(value);
}
async function installedAdapter(
  work: (repository: CloudRepository, calls: Call[]) => Promise<void>,
  options: {
    initial?: User;
    failAudit?: boolean;
    badUpdate?: boolean;
    conflictOnce?: boolean;
    defaultMissing?: boolean;
  } = {},
): Promise<void> {
  cloud.init({ env: 'offline-transactions-only' });
  const config: { env?: string; throwOnNotFound?: boolean } = options.defaultMissing
    ? {}
    : { throwOnNotFound: false };
  const database = cloud.database(config);
  const original = Db.reqClass;
  const calls: Call[] = [];
  let counter = 0;
  let commits = 0;
  const documents: Record<string, Record<string, unknown>[]> = {
    users: [{ ...(options.initial ?? user({ identity: 'parent' })) }],
    schools: [{ ...school() }],
    grades: [{ ...grade() }],
    classes: [{ ...classroom() }],
    class_memberships: [],
  };
  Db.reqClass = class OfflineTransport {
    async send(action: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
      calls.push({ action, parameters });
      if (action === 'database.startTransaction')
        return { transactionId: `offline_tx_${++counter}`, requestId: 'offline_request' };
      if (action === 'database.commitTransaction') {
        if (options.conflictOnce && commits++ === 0) {
          documents.users = [{ ...user({ identity: 'parent', role: 'user' }) }];
          return { code: 'DATABASE_TRANSACTION_CONFLICT', message: 'fixture conflict' };
        }
        return { requestId: 'offline_request' };
      }
      if (action === 'database.abortTransaction') return { requestId: 'offline_request' };
      if (action === 'database.getDocument') {
        const query = object(
          typeof parameters.query === 'string' ? JSON.parse(parameters.query) : parameters.query,
        );
        const entries = documents[String(parameters.collectionName)] ?? [];
        const found = entries
          .filter((entry) =>
            Object.entries(query).every(([key, value]) => {
              if (value === null) return entry[key] == null;
              if (isRecord(value) && typeof value.$gt === 'string')
                return typeof entry[key] === 'string' && entry[key] > value.$gt;
              return entry[key] === value;
            }),
          )
          .sort((left, right) => String(left._id).localeCompare(String(right._id)))
          .slice(0, typeof parameters.limit === 'number' ? parameters.limit : 1000);
        return { data: { list: found.map(encoded) }, requestId: 'offline_request' };
      }
      if (action === 'database.insertDocument') {
        if (options.failAudit && parameters.collectionName === 'admin_logs')
          return { code: 'PERMISSION_DENIED', message: 'private fixture secret' };
        if (!Array.isArray(parameters.data) || typeof parameters.data[0] !== 'string')
          throw Error('Unexpected SDK insertion serialization');
        const entry = object(JSON.parse(parameters.data[0]));
        return {
          data: { insertedIds: [entry._id ?? 'offline_audit'] },
          requestId: 'offline_request',
        };
      }
      if (action === 'database.modifyDocument')
        return { data: { updated: options.badUpdate ? 0 : 1 }, requestId: 'offline_request' };
      throw Error(`Unexpected SDK transport action ${action}`);
    }
  };
  try {
    const repository = new CloudRepository(() => database);
    await work(repository, calls);
  } finally {
    Db.reqClass = original;
  }
}

describe('installed wx-server-sdk transaction adapter (offline transport, no cloud contact)', () => {
  it('creates missing membership, patches user and adds audit in one real SDK transaction', async () => {
    await installedAdapter(async (repository, calls) => {
      const result = await selectClass(
        repository,
        user().openid,
        selection,
        NOW,
        'offline_request',
      );
      expect(result.onboardingStep).toBe('ready');
      const transactional = calls.filter(
        (call) => call.parameters.transactionId === 'offline_tx_1',
      );
      expect(transactional.filter((call) => call.action === 'database.getDocument')).toHaveLength(
        5,
      );
      const inserts = transactional.filter((call) => call.action === 'database.insertDocument');
      expect(inserts.map((call) => call.parameters.collectionName)).toEqual([
        'class_memberships',
        'admin_logs',
      ]);
      const raw = inserts[0]?.parameters.data;
      if (!Array.isArray(raw) || typeof raw[0] !== 'string')
        throw Error('Missing serialized membership');
      const member = object(JSON.parse(raw[0]));
      expect(member._id).toBe(membershipId('test_user', selection.classId));
      expect(member.createdAt).toHaveProperty('$date');
      const patch = transactional.find((call) => call.action === 'database.modifyDocument');
      expect(patch?.parameters.merge).toBe(true);
      expect(patch?.parameters.upsert).toBe(false);
      expect(patch?.parameters.data).not.toMatch(/role|adminSchoolId/);
      expect(calls.at(-1)?.action).toBe('database.commitTransaction');
    });
  });
  it('serializes active/free parent filters and ID cursor ordering through the installed SDK', async () => {
    await installedAdapter(async (repository, calls) => {
      const result = await repository.listClasses({
        schoolId: selection.schoolId,
        gradeId: selection.gradeId,
        afterId: 'a',
        limit: 101,
      });
      expect(result.map((item) => item._id)).toEqual([selection.classId]);
      const request = calls.find((call) => call.action === 'database.getDocument');
      expect(object(JSON.parse(String(request?.parameters.query)))).toEqual({
        status: 'active',
        deletedAt: null,
        schoolId: selection.schoolId,
        gradeId: selection.gradeId,
        joinMode: 'free',
        _id: { $gt: 'a' },
      });
      expect(request?.parameters.limit).toBe(101);
      expect(JSON.parse(String(request?.parameters.order))).toEqual({ _id: { $numberInt: '1' } });
    });
  });
  it('proves why explicit throwOnNotFound:false is required by the installed wx wrapper', async () => {
    await installedAdapter(
      async (repository, calls) => {
        await expect(
          selectClass(repository, user().openid, selection, NOW, 'offline_request'),
        ).rejects.toThrow();
        expect(calls.at(-1)?.action).toBe('database.abortTransaction');
        expect(calls.some((call) => call.action === 'database.insertDocument')).toBe(false);
      },
      { defaultMissing: true },
    );
  });
  it('aborts the actual SDK transaction when audit insertion fails', async () => {
    await installedAdapter(
      async (repository, calls) => {
        await expect(
          selectClass(repository, user().openid, selection, NOW, 'offline_request'),
        ).rejects.toThrow();
        expect(calls.at(-1)?.action).toBe('database.abortTransaction');
        expect(calls.some((call) => call.action === 'database.commitTransaction')).toBe(false);
      },
      { failAudit: true },
    );
  });
  it('aborts rather than accepting an unacknowledged user update', async () => {
    await installedAdapter(
      async (repository, calls) => {
        await expect(
          updateProfile(repository, user().openid, { identity: 'teacher' }, NOW, 'offline_request'),
        ).rejects.toThrow('acknowledged');
        expect(calls.at(-1)?.action).toBe('database.abortTransaction');
      },
      { badUpdate: true },
    );
  });
  it('re-reads the user and returns the retried result after an actual SDK conflict retry', async () => {
    await installedAdapter(
      async (repository, calls) => {
        const result = await updateProfile(
          repository,
          user().openid,
          { identity: 'teacher' },
          NOW,
          'offline_request',
        );
        expect(result.user.role).toBe('user');
        expect(calls.filter((call) => call.action === 'database.startTransaction')).toHaveLength(2);
        expect(
          calls.filter(
            (call) =>
              call.action === 'database.getDocument' && call.parameters.transactionId !== undefined,
          ),
        ).toHaveLength(2);
        expect(calls.at(-1)?.action).toBe('database.commitTransaction');
      },
      {
        initial: user({ role: 'admin', adminSchoolId: 'test_school_a', identity: 'parent' }),
        conflictOnce: true,
      },
    );
  });
});
