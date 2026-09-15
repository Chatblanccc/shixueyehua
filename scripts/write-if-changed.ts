import { readFile, writeFile } from 'node:fs/promises';

/** Preserve mtimes so routine checks don't make DevTools restart an unchanged app. */
export async function writeIfChanged(path: string, content: string): Promise<void> {
  try {
    if ((await readFile(path, 'utf8')) === content) return;
  } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  await writeFile(path, content);
}
