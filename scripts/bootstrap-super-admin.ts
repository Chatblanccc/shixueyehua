import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDataPort } from './database/cloudbase';
import { bootstrapSuperAdmin, DatabaseScriptError } from './database/core';
import {
  environmentFingerprint,
  loadApplyConfiguration,
  parseArguments,
  safeFailure,
} from './database/cli';

async function main(): Promise<void> {
  const argumentsValue = parseArguments(process.argv.slice(2));
  if (!argumentsValue.apply) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: 'dry-run',
          cloudContacted: false,
          requiredStage: 'dev',
          action: 'grant first super_admin to an existing active user after trusted WeChat login',
          atomicAuditReceipt: 'admin_logs/bootstrap:first-super-admin',
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const { target, connection } = await loadApplyConfiguration(
    argumentsValue,
    process.env,
    fileURLToPath(new URL('..', import.meta.url)),
  );
  const trustedOpenId = process.env.SHIXUE_BOOTSTRAP_OPENID;
  if (!trustedOpenId) throw new DatabaseScriptError('TRUSTED_OPENID_REQUIRED');
  const requestId = randomUUID();
  const status = await bootstrapSuperAdmin(
    target,
    trustedOpenId,
    requestId,
    createDataPort(connection),
  );
  process.stdout.write(
    `${JSON.stringify({ status, requestId, environmentFingerprint: environmentFingerprint(target.environmentId) })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
  process.exitCode = 1;
});
