import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { assertDevTarget, DatabaseScriptError, isRecord, type DevTarget } from './core';
import type { CloudBaseConnection } from './cloudbase';

export interface ScriptArguments {
  apply: boolean;
  environmentId?: string;
}

export function parseArguments(argumentsList: readonly string[]): ScriptArguments {
  const result: ScriptArguments = { apply: false };
  let dryRun = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--apply' && !result.apply) result.apply = true;
    else if (argument === '--dry-run' && !dryRun) dryRun = true;
    else if (argument === '--env' && !result.environmentId) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new DatabaseScriptError('INVALID_ARGUMENTS');
      result.environmentId = value;
      index += 1;
    } else throw new DatabaseScriptError('INVALID_ARGUMENTS');
  }
  if (dryRun && result.apply) throw new DatabaseScriptError('INVALID_ARGUMENTS');
  return result;
}

export async function loadApplyConfiguration(
  argumentsValue: ScriptArguments,
  environment: NodeJS.ProcessEnv,
  rootDirectory: string,
): Promise<{ target: DevTarget; connection: CloudBaseConnection }> {
  if (!argumentsValue.apply) throw new DatabaseScriptError('APPLY_REQUIRED');
  if (environment.SHIXUE_ENV !== 'dev') throw new DatabaseScriptError('DEV_ONLY');
  if (!argumentsValue.environmentId) throw new DatabaseScriptError('EXPLICIT_ENVIRONMENT_REQUIRED');
  let configuration: unknown;
  let project: unknown;
  try {
    configuration = JSON.parse(
      await readFile(resolve(rootDirectory, 'config/environments.local.json'), 'utf8'),
    ) as unknown;
    project = JSON.parse(
      await readFile(resolve(rootDirectory, 'project.config.json'), 'utf8'),
    ) as unknown;
  } catch {
    throw new DatabaseScriptError('LOCAL_CONFIGURATION_REQUIRED');
  }
  if (
    !isRecord(configuration) ||
    !isRecord(configuration.dev) ||
    typeof configuration.dev.envId !== 'string'
  ) {
    throw new DatabaseScriptError('LOCAL_CONFIGURATION_INVALID');
  }
  const target: DevTarget = {
    stage: environment.SHIXUE_ENV,
    environmentId: argumentsValue.environmentId,
    devEnvironmentId: configuration.dev.envId,
    otherEnvironmentIds: [configuration.test, configuration.prod].flatMap((item) =>
      isRecord(item) && typeof item.envId === 'string' && item.envId ? [item.envId] : [],
    ),
  };
  assertDevTarget(target);
  const appId: unknown =
    environment.SHIXUE_APP_ID || (isRecord(project) ? project.appid : undefined);
  if (typeof appId !== 'string' || !/^wx[0-9a-f]{16}$/.test(appId)) {
    throw new DatabaseScriptError('VALID_APP_ID_REQUIRED');
  }
  const secretId = environment.TENCENTCLOUD_SECRETID;
  const secretKey = environment.TENCENTCLOUD_SECRETKEY;
  if (!secretId || !secretKey) throw new DatabaseScriptError('TENCENT_CREDENTIALS_REQUIRED');
  return {
    target,
    connection: {
      environmentId: target.environmentId,
      appId,
      secretId,
      secretKey,
      ...(environment.TENCENTCLOUD_SESSIONTOKEN
        ? { sessionToken: environment.TENCENTCLOUD_SESSIONTOKEN }
        : {}),
      ...(environment.TENCENTCLOUD_REGION ? { region: environment.TENCENTCLOUD_REGION } : {}),
    },
  };
}

export function environmentFingerprint(environmentId: string): string {
  return createHash('sha256').update(environmentId).digest('hex').slice(0, 12);
}

export function safeFailure(error: unknown): { status: 'failed'; code: string } {
  return {
    status: 'failed',
    code: error instanceof DatabaseScriptError ? error.code : 'CLOUDBASE_OPERATION_FAILED',
  };
}
