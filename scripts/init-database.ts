import { fileURLToPath } from 'node:url';
import { createDataPort, createManagementPort } from './database/cloudbase';
import { initializeDatabase } from './database/core';
import { DATABASE_MANIFEST, DENY_CLIENT_ACCESS } from './database/manifest';
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
          collections: DATABASE_MANIFEST,
          rules: DENY_CLIENT_ACCESS,
          seeds: '1 fictional school, 2 grades, 4 classes, 1 global config; no users',
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
  const result = await initializeDatabase(
    target,
    createManagementPort(connection),
    createDataPort(connection),
  );
  process.stdout.write(
    `${JSON.stringify({
      mode: 'apply',
      environmentFingerprint: environmentFingerprint(target.environmentId),
      ...result,
      clientAccessVerification: 'pending-real-wechat-client-test',
    })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`);
  process.exitCode = 1;
});
