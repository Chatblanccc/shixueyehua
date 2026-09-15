import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = fileURLToPath(new URL('./sdk-compatibility.cjs', import.meta.url));

describe('installed SDK dependency compatibility (offline)', () => {
  it.each([
    ['paths', 'production'],
    ['database', 'production'],
    ['http', 'production'],
    ['paths', 'local'],
    ['database', 'local'],
    ['http', 'local'],
    ['developerTools', 'local'],
  ])('%s runs against the installed %s SDK and patched dependency tree', (suite, scope) => {
    const output = execFileSync(process.execPath, [harness, root, suite, scope], {
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(JSON.parse(output)).toEqual({ suite, passed: true, cloudContacted: false });
  });
});
