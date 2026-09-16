import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { isRecord } from '../shared';
import { cloudPermissions } from './cloud-permissions';

const names = ['authApi', 'classApi', 'audioApi', 'letterApi', 'adminAudioApi', 'adminApi'];
const source = 'dist/cloudfunctions/authApi';
const directory = await mkdtemp(join(tmpdir(), 'shixue-cloud-packages-'));
try {
  const vendorFiles = await readdir(`${source}/vendor`);
  const runtimeFiles = [
    'package.json',
    'package-lock.json',
    ...vendorFiles.map((file) => `vendor/${file}`),
  ];
  // Inspect actual deployment artifacts, including every local dependency archive.
  // All six packages must carry the exact same runtime and cannot rely on the repository.
  for (const name of names) {
    const config: unknown = JSON.parse(
      await readFile(`dist/cloudfunctions/${name}/config.json`, 'utf8'),
    );
    if (
      !isRecord(config) ||
      !isRecord(config.permissions) ||
      JSON.stringify(config.permissions.openapi) !== JSON.stringify(cloudPermissions(name))
    )
      throw new Error(`${name} OpenAPI 权限与最小授权清单不一致。`);
    for (const file of runtimeFiles) {
      const expected = await readFile(`${source}/${file}`);
      const actual = await readFile(`dist/cloudfunctions/${name}/${file}`);
      if (!actual.equals(expected)) throw new Error(`${name}/${file} 与统一运行依赖不一致。`);
    }
  }
  for (const file of ['package.json', 'package-lock.json']) {
    await copyFile(`${source}/${file}`, join(directory, file));
  }
  await cp(`${source}/vendor`, join(directory, 'vendor'), { recursive: true });
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: directory,
    stdio: 'pipe',
    timeout: 120000,
  });
  // Audit the dependency tree installed from an actual deployment lockfile.
  execFileSync('npm', ['audit', '--omit=dev', '--audit-level=moderate'], {
    cwd: directory,
    stdio: 'pipe',
    timeout: 60000,
  });
  const require = createRequire(join(directory, 'package.json'));
  for (const name of names) {
    await mkdir(join(directory, name));
    const entry = join(directory, name, 'index.js');
    await copyFile(`dist/cloudfunctions/${name}/index.js`, entry);
    const loaded: unknown = require(entry);
    if (!isRecord(loaded) || typeof loaded.main !== 'function')
      throw new Error(`${name} 未导出 main。`);
  }
  console.log('6 个实际云函数包在仓库外加载通过，部署依赖审计通过；未调用云接口。');
} finally {
  await rm(directory, { recursive: true, force: true });
}
