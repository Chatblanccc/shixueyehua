import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { isRecord } from '../shared';
import { cloudPermissions } from './cloud-permissions';

const functions = ['authApi', 'classApi', 'audioApi', 'letterApi', 'adminAudioApi', 'adminApi'];
const rootPackage: unknown = JSON.parse(await readFile('package.json', 'utf8'));
if (!isRecord(rootPackage) || !isRecord(rootPackage.dependencies))
  throw new Error('缺少云函数依赖。');
const dependencies = rootPackage.dependencies;
const sdkVersion = dependencies['wx-server-sdk'];
if (typeof sdkVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(sdkVersion))
  throw new Error('SDK 必须锁定精确版本。');
const runtimePackage: unknown = JSON.parse(
  await readFile('config/cloud-runtime/package.json', 'utf8'),
);
const runtimeLock: unknown = JSON.parse(
  await readFile('config/cloud-runtime/package-lock.json', 'utf8'),
);
if (
  !isRecord(runtimePackage) ||
  !isRecord(runtimePackage.dependencies) ||
  runtimePackage.dependencies['wx-server-sdk'] !== sdkVersion ||
  !isRecord(runtimeLock) ||
  !isRecord(runtimeLock.packages)
)
  throw new Error('根依赖与云函数运行清单不一致。');
const lockedRoot = runtimeLock.packages[''];
const lockedSdk = runtimeLock.packages['node_modules/wx-server-sdk'];
if (
  !isRecord(lockedRoot) ||
  !isRecord(lockedRoot.dependencies) ||
  lockedRoot.dependencies['wx-server-sdk'] !== sdkVersion ||
  !isRecord(lockedSdk) ||
  lockedSdk.version !== sdkVersion
)
  throw new Error('云函数 SDK 锁文件与实际版本不一致。');
for (const [name, version] of Object.entries(runtimePackage.dependencies)) {
  if (name === 'lodash.set') continue; // Same vendored archive has a different relative path.
  const locked: unknown = runtimeLock.packages[`node_modules/${name}`];
  if (
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    dependencies[name] !== version ||
    lockedRoot.dependencies[name] !== version ||
    !isRecord(locked) ||
    locked.version !== version
  )
    throw new Error(`云函数依赖 ${name} 未精确对齐。`);
}
const outRoot = 'dist/cloudfunctions';
await rm(outRoot, { recursive: true, force: true });
for (const name of functions) {
  const directory = `${outRoot}/${name}`;
  await mkdir(directory, { recursive: true });
  await build({
    entryPoints: [`cloudfunctions/${name}/index.ts`],
    outfile: `${directory}/index.js`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: Object.keys(runtimePackage.dependencies),
    sourcemap: false,
    metafile: true,
  });
  await copyFile('config/cloud-runtime/package.json', `${directory}/package.json`);
  await copyFile('config/cloud-runtime/package-lock.json', `${directory}/package-lock.json`);
  await cp('config/cloud-runtime/vendor', `${directory}/vendor`, { recursive: true });
  await writeFile(
    `${directory}/config.json`,
    JSON.stringify({ permissions: { openapi: cloudPermissions(name) } }, null, 2) + '\n',
  );
}
console.log(
  `已构建 ${functions.length} 个独立云函数源码包；部署前仍需安装包内生产依赖并核验目标运行时。`,
);
