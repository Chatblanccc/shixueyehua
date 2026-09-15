import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { writeIfChanged } from './write-if-changed';

export async function buildShared(): Promise<void> {
  await mkdir('miniprogram/generated', { recursive: true });
  const result = await build({
    entryPoints: ['shared/index.ts'],
    outfile: 'miniprogram/generated/shared.js',
    bundle: true,
    platform: 'neutral',
    format: 'cjs',
    target: 'es2020',
    sourcemap: false,
    write: false,
  });
  for (const file of result.outputFiles) await writeIfChanged(file.path, file.text);
  await writeIfChanged(
    'miniprogram/generated/shared.d.ts',
    "export * from '../../shared/index';\n",
  );
}

if (process.argv[1]?.endsWith('build-shared.ts')) {
  await buildShared();
  console.log('共享模块已生成到 miniprogram/generated。');
}
