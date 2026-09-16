import { describe, expect, it, vi } from 'vitest';
import {
  CloudAudioStorage,
  inspectMedia,
  readBounded,
  type StorageSdkPort,
} from '../../cloudfunctions/_shared/audio-storage';
const env = 'school-dev';
const raw = 'audio-quarantine/school-1/2026/12345678-1234-1234-1234-123456789abc.mp3';
const finalPath = raw.replace('audio-quarantine', 'audio-media');
const fileId = (path: string) => `cloud://${env}.bucket/${path}`;
const now = new Date('2026-09-16T00:00:00Z');
const grant = (path = raw) => ({
  data: {
    fileId: fileId(path),
    url: 'https://bucket.cos.ap-shanghai.myqcloud.com/file',
    token: 'temporary-token',
    cosFileId: 'metadata-id',
    authorization:
      'q-sign-algorithm=sha1&q-sign-time=1789516500;1789518600&q-key-time=1789516500;1789519200',
  },
});
function setup(request: typeof fetch = vi.fn<typeof fetch>()) {
  const sdk: StorageSdkPort = {
    getUploadMetadata: vi.fn(async ({ cloudPath }) => grant(cloudPath)),
    getTempFileURL: vi.fn(
      async ({ fileList }: { fileList: { fileID: string; maxAge: number }[] }) => ({
        fileList: fileList.map(({ fileID }) => ({
          fileID,
          code: 'SUCCESS',
          tempFileURL: 'https://bucket.cos.ap-shanghai.myqcloud.com/media',
        })),
      }),
    ),
    deleteFile: vi.fn(async ({ fileList }: { fileList: string[] }) => ({
      fileList: fileList.map((fileID) => ({ fileID, code: 'SUCCESS' })),
    })),
  };
  return {
    sdk,
    storage: new CloudAudioStorage(
      () => sdk,
      () => env,
      request,
    ),
  };
}
function mp3(): Buffer {
  const frame = Buffer.alloc(417);
  Buffer.from([0xff, 0xfb, 0x90, 0xc0]).copy(frame);
  return Buffer.concat(Array.from({ length: 40 }, () => frame));
}
describe('real media parsing and bounded storage adapter', () => {
  it('derives actual signed expiry and a PUT grant for the exact quarantine path', async () => {
    const { storage } = setup();
    const ticket = await storage.prepare(raw, now);
    expect(ticket.method).toBe('PUT');
    expect(ticket.expiresAt.getTime()).toBe(1789518600000);
    expect(ticket.headers.key).toBe(encodeURIComponent(raw));
  });
  it.each([finalPath, '../a.mp3', `${raw}/extra`])(
    'refuses public write capability for %s',
    async (path) => {
      const { storage, sdk } = setup();
      await expect(storage.prepare(path, now)).rejects.toThrow();
      expect(sdk.getUploadMetadata).not.toHaveBeenCalled();
    },
  );
  it('rejects expired, foreign-file, and untrusted-host SDK responses', async () => {
    const { storage, sdk } = setup();
    await expect(storage.prepare(raw, new Date('2030-01-01'))).rejects.toThrow();
    const invalidFile = grant();
    invalidFile.data.fileId = 'cloud://other.bucket/' + raw;
    vi.mocked(sdk.getUploadMetadata).mockResolvedValueOnce(invalidFile);
    await expect(storage.prepare(raw, now)).rejects.toThrow();
    const invalidUrl = grant();
    invalidUrl.data.url = 'https://127.0.0.1/private';
    vi.mocked(sdk.getUploadMetadata).mockResolvedValueOnce(invalidUrl);
    await expect(storage.prepare(raw, now)).rejects.toThrow();
  });
  it('parses real MPEG frame headers and duration instead of accepting supplied metadata', async () => {
    const result = await inspectMedia(mp3(), 'audio', 'mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.duration).toBeGreaterThan(1);
    await expect(inspectMedia(Buffer.from('not an mp3'), 'audio', 'mp3')).rejects.toThrow();
    await expect(inspectMedia(mp3(), 'cover', 'mp3')).rejects.toThrow();
    await expect(inspectMedia(mp3(), 'audio', 'm4a')).rejects.toThrow();
  });
  it('rejects oversized streams without Content-Length and stops the reader', async () => {
    const cancelled = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(new Uint8Array(16));
        },
        cancel: cancelled,
      }),
    );
    await expect(readBounded(response, 10)).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('rejects oversized declared length and truncated content', async () => {
    await expect(
      readBounded(new Response('small', { headers: { 'content-length': '999' } }), 10),
    ).rejects.toThrow();
    await expect(readBounded(new Response('small'), 10, 10)).rejects.toThrow();
  });
  it('never seals mismatched size or non-media and rejects cross-school final paths', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('invalid'));
    const { storage, sdk } = setup(request);
    await expect(
      storage.inspectAndSeal({
        sourceFileId: fileId(raw),
        finalPath,
        kind: 'audio',
        expectedBytes: 8,
        maxBytes: 10,
      }),
    ).rejects.toThrow();
    expect(sdk.getUploadMetadata).not.toHaveBeenCalled();
    request.mockClear();
    await expect(
      storage.inspectAndSeal({
        sourceFileId: fileId(raw),
        finalPath: finalPath.replace('school-1', 'school-2'),
        kind: 'audio',
        expectedBytes: 8,
        maxBytes: 10,
      }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('puts verified bytes once with checksum and rejects ambiguous XML success', async () => {
    const bytes = mp3();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(bytes))
      .mockResolvedValueOnce(new Response('<Error>failed</Error>'));
    const { storage, sdk } = setup(request);
    vi.mocked(sdk.getUploadMetadata).mockImplementation(async ({ cloudPath }) => {
      const value = grant(cloudPath);
      value.data.authorization = 'q-sign-time=1;4102444800&q-key-time=1;4102444800';
      return value;
    });
    await expect(
      storage.inspectAndSeal({
        sourceFileId: fileId(raw),
        finalPath,
        kind: 'audio',
        expectedBytes: bytes.length,
        maxBytes: 50000,
      }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
    const upload = request.mock.calls[1]?.[1];
    expect(upload?.method).toBe('PUT');
    expect(upload?.redirect).toBe('error');
    expect(upload?.headers).toMatchObject({
      'x-cos-forbid-overwrite': 'true',
      'Content-Type': 'audio/mpeg',
    });
  });
  it('requires a per-file acknowledged delete; only explicit absence is idempotent', async () => {
    const { storage, sdk } = setup();
    vi.mocked(sdk.deleteFile).mockResolvedValueOnce({ fileList: [] });
    await expect(storage.deleteFiles([fileId(raw)])).rejects.toThrow();
    vi.mocked(sdk.deleteFile).mockResolvedValueOnce({
      fileList: [{ fileID: fileId(raw), code: 'STORAGE_FILE_NONEXIST' }],
    });
    await expect(storage.deleteFiles([fileId(raw)])).resolves.toBeUndefined();
    vi.mocked(sdk.deleteFile).mockResolvedValueOnce({
      fileList: [{ fileID: fileId(raw), code: 'FORBIDDEN' }],
    });
    await expect(storage.deleteFiles([fileId(raw)])).rejects.toThrow();
  });
});
