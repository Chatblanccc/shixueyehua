import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadApplyConfiguration, parseArguments, safeFailure } from '../../scripts/database/cli';
import {
  documentFromResponse,
  parseIndexes,
  successfulResponse,
  verifyDenyRule,
} from '../../scripts/database/cloudbase';
import { DENY_CLIENT_ACCESS } from '../../scripts/database/manifest';

describe('CLI guards and external value validation', () => {
  it('defaults to an offline dry run and rejects ambiguous arguments', () => {
    expect(parseArguments([])).toEqual({ apply: false });
    expect(parseArguments(['--env', 'fictional-dev-env'])).toEqual({
      apply: false,
      environmentId: 'fictional-dev-env',
    });
    expect(() => parseArguments(['--apply', '--dry-run'])).toThrow('INVALID_ARGUMENTS');
    expect(() => parseArguments(['--openid', 'sensitive-input'])).toThrow('INVALID_ARGUMENTS');
    expect(() => parseArguments(['--env'])).toThrow('INVALID_ARGUMENTS');
  });

  it('requires explicit dev environment and standard Tencent credential variables', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shixue-database-test-'));
    try {
      await mkdir(join(directory, 'config'));
      await writeFile(
        join(directory, 'config/environments.local.json'),
        JSON.stringify({
          dev: { envId: 'fictional-dev-env' },
          prod: { envId: 'fictional-prod-env' },
        }),
      );
      await writeFile(
        join(directory, 'project.config.json'),
        JSON.stringify({ appid: 'wx0000000000000000' }),
      );
      const argumentsValue = { apply: true, environmentId: 'fictional-dev-env' };
      await expect(loadApplyConfiguration(argumentsValue, {}, directory)).rejects.toThrow(
        'DEV_ONLY',
      );
      await expect(
        loadApplyConfiguration({ apply: true }, { SHIXUE_ENV: 'dev' }, directory),
      ).rejects.toThrow('EXPLICIT_ENVIRONMENT_REQUIRED');
      await expect(
        loadApplyConfiguration(argumentsValue, { SHIXUE_ENV: 'dev' }, directory),
      ).rejects.toThrow('TENCENT_CREDENTIALS_REQUIRED');
      await expect(
        loadApplyConfiguration(
          { ...argumentsValue, environmentId: 'fictional-prod-env' },
          { SHIXUE_ENV: 'dev' },
          directory,
        ),
      ).rejects.toThrow('DEV_ENVIRONMENT_MISMATCH');
      const loaded = await loadApplyConfiguration(
        argumentsValue,
        {
          SHIXUE_ENV: 'dev',
          TENCENTCLOUD_SECRETID: 'fictional-sdk-test-id',
          TENCENTCLOUD_SECRETKEY: 'fictional-sdk-test-key',
        },
        directory,
      );
      expect(loaded.connection.environmentId).toBe('fictional-dev-env');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('never includes raw SDK errors with credentials in command output', () => {
    expect(safeFailure(new Error('openid=raw-value; secretId=sensitive'))).toEqual({
      status: 'failed',
      code: 'CLOUDBASE_OPERATION_FAILED',
    });
  });

  it('validates SDK errors and document response shapes', () => {
    expect(() =>
      successfulResponse({ code: 'PERMISSION_DENIED', message: 'private detail' }),
    ).toThrow('CLOUDBASE_REQUEST_FAILED');
    expect(documentFromResponse({ data: null })).toBeNull();
    expect(documentFromResponse({ data: [] })).toBeNull();
    expect(documentFromResponse({ data: [{ _id: 'sample' }] })).toEqual({ _id: 'sample' });
    expect(documentFromResponse({ data: { _id: 'sample' } })).toEqual({ _id: 'sample' });
    expect(() => documentFromResponse({ data: 'bad' })).toThrow('INVALID_DOCUMENT_RESPONSE');
    expect(() => documentFromResponse({})).toThrow('INVALID_DOCUMENT_RESPONSE');
    expect(() => documentFromResponse({ data: [{ _id: 'one' }, { _id: 'two' }] })).toThrow(
      'INVALID_DOCUMENT_RESPONSE',
    );
  });

  it('parses the manager SDK index schema and fails closed on unknown schemas', () => {
    expect(
      parseIndexes({
        Indexes: [
          { Name: 'openid_unique', Unique: true, Keys: [{ Name: 'openid', Direction: '1' }] },
        ],
      }),
    ).toEqual([
      { name: 'openid_unique', unique: true, keys: [{ name: 'openid', direction: '1' }] },
    ]);
    expect(() => parseIndexes({ Indexes: [{ Name: 'index', Keys: [] }] })).toThrow(
      'INVALID_INDEX_RESPONSE',
    );
    expect(() => parseIndexes({})).toThrow('INVALID_INDEX_RESPONSE');
  });

  it('checks both rule files against the deployable rule and rejects any open access', async () => {
    for (const file of ['database.rules.json', 'storage.rules.json']) {
      const text = await readFile(new URL(`../../database/rules/${file}`, import.meta.url), 'utf8');
      expect(JSON.parse(text)).toEqual(DENY_CLIENT_ACCESS);
      expect(() => verifyDenyRule(text)).not.toThrow();
    }
    expect(() => verifyDenyRule({ read: true, write: false })).toThrow('DENY_RULE_NOT_CONFIRMED');
    expect(() => verifyDenyRule({ read: false, write: 'auth != null' })).toThrow(
      'DENY_RULE_NOT_CONFIRMED',
    );
    expect(() => verifyDenyRule('{malformed')).toThrow('INVALID_RULE_RESPONSE');
  });
});
