import { createHash } from 'node:crypto';
import cloudbase from '@cloudbase/node-sdk';
import { isRecord, type UploadKind } from '../../shared';
import type { AudioStoragePort, UploadGrant, VerifiedMedia } from './audio-storage-port';

export interface StorageSdkPort {
  getUploadMetadata(input: { cloudPath: string }): Promise<unknown>;
  getTempFileURL(input: { fileList: { fileID: string; maxAge: number }[] }): Promise<unknown>;
  deleteFile(input: { fileList: string[] }): Promise<unknown>;
}
const pathPattern =
  /^(audio|letter)-(quarantine|media)\/[A-Za-z0-9_-]+\/\d{4}\/[0-9a-f-]{36}\.(mp3|m4a|jpe?g|png|webp)$/;
const maxAudioBytes = 50 * 1024 * 1024;
function fail(): never {
  throw new Error('音频存储校验失败，请重新上传或稍后重试。');
}
function safeUrl(value: unknown): string {
  if (typeof value !== 'string') return fail();
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !/(?:^|\.)(?:myqcloud\.com|tcb\.qcloud\.la|tcloudbase\.com)$/.test(url.hostname)
  )
    fail();
  return url.href;
}
function pathOf(fileId: string, env: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(env)) fail();
  const match = /^cloud:\/\/([^/]+)\/(.+)$/.exec(fileId);
  if (!match || !match[1]?.startsWith(`${env}.`) || !match[2] || !pathPattern.test(match[2]))
    fail();
  return match[2];
}
export async function readBounded(
  response: Response,
  maxBytes: number,
  expectedBytes?: number,
): Promise<Buffer> {
  if (!response.ok || !response.body) fail();
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes || (expectedBytes !== undefined && size > expectedBytes)) fail();
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (expectedBytes !== undefined && size !== expectedBytes) fail();
  return Buffer.concat(chunks, size);
}
export async function inspectMedia(
  bytes: Buffer,
  kind: UploadKind,
  extension: string,
): Promise<VerifiedMedia> {
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(bytes);
  const canonicalExtension = extension === 'jpeg' ? 'jpg' : extension;
  if (!detected || detected.ext !== canonicalExtension) fail();
  if (kind === 'cover') {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime) ||
      bytes.length > 5 * 1024 * 1024
    )
      fail();
    return { fileSize: bytes.length, mimeType: detected.mime };
  }
  if (
    !['audio/mpeg', 'audio/x-m4a', 'audio/mp4'].includes(detected.mime) ||
    bytes.length > maxAudioBytes
  )
    fail();
  const { parseBuffer } = await import('music-metadata');
  const metadata = await parseBuffer(
    bytes,
    { mimeType: detected.mime, size: bytes.length },
    { duration: true, skipCovers: true },
  );
  const duration = metadata.format.duration;
  if (
    !duration ||
    !Number.isFinite(duration) ||
    duration > 14400 ||
    !metadata.format.numberOfChannels ||
    metadata.format.trackInfo?.some((track) => track.type === 1)
  )
    fail();
  return { fileSize: bytes.length, mimeType: detected.mime, duration };
}

/** SDK URLs and file IDs are trusted only after environment/path validation. No client URL is fetched. */
export class CloudAudioStorage implements AudioStoragePort {
  constructor(
    private readonly sdk: () => StorageSdkPort,
    private readonly env: () => string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async grant(cloudPath: string, now: Date): Promise<UploadGrant> {
    if (!pathPattern.test(cloudPath)) fail();
    const result = await this.sdk().getUploadMetadata({ cloudPath });
    if (!isRecord(result) || !isRecord(result.data)) fail();
    const data = result.data;
    if (
      typeof data.fileId !== 'string' ||
      pathOf(data.fileId, this.env()) !== cloudPath ||
      typeof data.authorization !== 'string' ||
      typeof data.token !== 'string' ||
      typeof data.cosFileId !== 'string'
    )
      fail();
    const params = new URLSearchParams(data.authorization);
    const ends = ['q-sign-time', 'q-key-time'].map((key) => {
      const value = params.get(key);
      if (!value || !/^\d+;\d+$/.test(value)) return fail();
      return Number(value.split(';')[1]) * 1000;
    });
    const expiresAt = new Date(Math.min(...ends));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) fail();
    return {
      fileId: data.fileId,
      uploadUrl: safeUrl(data.url),
      method: 'PUT',
      expiresAt,
      headers: {
        Signature: data.authorization,
        authorization: data.authorization,
        'x-cos-security-token': data.token,
        'x-cos-meta-fileid': data.cosFileId,
        key: encodeURIComponent(cloudPath),
      },
    };
  }
  async prepare(cloudPath: string, now: Date): Promise<UploadGrant> {
    if (!/^(audio|letter)-quarantine\//.test(cloudPath)) fail();
    return this.grant(cloudPath, now);
  }
  async temporaryUrl(fileId: string, maxAgeSeconds: number): Promise<string> {
    pathOf(fileId, this.env());
    if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 600) fail();
    const result = await this.sdk().getTempFileURL({
      fileList: [{ fileID: fileId, maxAge: maxAgeSeconds }],
    });
    if (!isRecord(result) || !Array.isArray(result.fileList)) fail();
    const item: unknown = result.fileList[0];
    if (!isRecord(item) || item.fileID !== fileId || item.code !== 'SUCCESS') fail();
    return safeUrl(item.tempFileURL);
  }
  async inspectAndSeal(input: {
    sourceFileId: string;
    finalPath: string;
    kind: UploadKind;
    expectedBytes: number;
    maxBytes: number;
  }): Promise<VerifiedMedia & { fileId: string }> {
    const sourcePath = pathOf(input.sourceFileId, this.env());
    if (
      !/^(audio|letter)-quarantine\//.test(sourcePath) ||
      !input.finalPath.startsWith(`${sourcePath.split('-')[0]}-media/`) ||
      (sourcePath.startsWith('letter-') &&
        (input.kind !== 'cover' || !/\.(jpe?g|png)$/.test(sourcePath))) ||
      !pathPattern.test(input.finalPath) ||
      sourcePath.split('/')[1] !== input.finalPath.split('/')[1] ||
      sourcePath.split('.').pop() !== input.finalPath.split('.').pop() ||
      !Number.isInteger(input.expectedBytes) ||
      input.expectedBytes < 1 ||
      input.expectedBytes > input.maxBytes ||
      input.maxBytes > maxAudioBytes
    )
      fail();
    const url = await this.temporaryUrl(input.sourceFileId, 60);
    const response = await this.request(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
    });
    const bytes = await readBounded(response, input.maxBytes, input.expectedBytes);
    const info = await inspectMedia(bytes, input.kind, sourcePath.split('.').pop() ?? '');
    const grant = await this.grant(input.finalPath, new Date());
    // Business transaction permits exactly one seal attempt per ticket. This header adds protection
    // on non-versioned COS buckets; correctness does not depend on that bucket setting.
    const uploaded = await this.request(grant.uploadUrl, {
      method: 'PUT',
      redirect: 'error',
      signal: AbortSignal.timeout(60000),
      body: new Uint8Array(bytes),
      headers: {
        ...grant.headers,
        'Content-Type': info.mimeType,
        'Content-MD5': createHash('md5').update(bytes).digest('base64'),
        'x-cos-forbid-overwrite': 'true',
      },
    });
    if (uploaded.status !== 200) fail();
    if ((await readBounded(uploaded, 8192)).length !== 0) fail();
    return { ...info, fileId: grant.fileId };
  }
  async deleteFiles(fileIds: string[]): Promise<void> {
    const unique = [...new Set(fileIds)];
    if (unique.length === 0) return;
    unique.forEach((id) => pathOf(id, this.env()));
    const result = await this.sdk().deleteFile({ fileList: unique });
    if (!isRecord(result) || !Array.isArray(result.fileList)) fail();
    for (const id of unique) {
      const item: unknown = result.fileList.find(
        (entry: unknown) => isRecord(entry) && entry.fileID === id,
      );
      if (!isRecord(item) || !['SUCCESS', 'STORAGE_FILE_NONEXIST'].includes(String(item.code)))
        fail();
    }
  }
}
export function createAudioStorage(envProvider: () => string): AudioStoragePort {
  let instance: StorageSdkPort | undefined;
  return new CloudAudioStorage(
    () => (instance ??= cloudbase.init({ env: envProvider() })),
    envProvider,
  );
}
