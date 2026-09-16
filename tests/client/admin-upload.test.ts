import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../miniprogram/services/local-mode', () => ({ localModeEnabled: () => false }));
vi.mock('../../miniprogram/services/cloud-api', () => ({ callCloud: vi.fn() }));
import { callCloud } from '../../miniprogram/services/cloud-api';
import { MediaUpload } from '../../miniprogram/services/admin-audio.service';
const call = vi.mocked(callCloud);
const file = { path: '/tmp/picked.mp3', name: 'picked.mp3', size: 10 };
const grant = {
  ticketId: 'ticket',
  uploadUrl: 'https://bucket.example.test/audio',
  method: 'PUT',
  headers: { authorization: 'fixture' },
  maxBytes: 100,
  expiresAt: '2099-01-01T00:00:00.000Z',
};
afterEach(() => {
  vi.unstubAllGlobals();
  call.mockReset();
});
function mockWx(statusCode = 200) {
  const request = vi.fn(
    (options: { success?: (result: { statusCode: number; data: string }) => void }) => {
      options.success?.({ statusCode, data: '' });
      return { abort: vi.fn() };
    },
  );
  const readFile = vi.fn((options: { success(result: { data: ArrayBuffer }): void }) =>
    options.success({ data: new ArrayBuffer(10) }),
  );
  vi.stubGlobal('wx', { getFileSystemManager: () => ({ readFile }), request });
  return { request, readFile };
}
describe('管理员真实传输控制', () => {
  it('按精确票据 PUT 实际字节并等待服务端确认，不将传输完成当成校验完成', async () => {
    const wx = mockWx();
    const phases: string[] = [];
    call.mockResolvedValueOnce(grant).mockResolvedValueOnce({
      ticketId: 'ticket',
      duration: 30,
      fileSize: 10,
      kind: 'audio',
      mimeType: 'audio/mpeg',
    });
    const result = await new MediaUpload().run(file, 'school', 'audio', (p) => phases.push(p));
    expect(result.ticketId).toBe('ticket');
    expect(wx.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        data: expect.any(ArrayBuffer),
        url: grant.uploadUrl,
        header: grant.headers,
      }),
    );
    expect(call.mock.calls.map((c) => c[1])).toEqual(['prepareUpload', 'confirmUpload']);
    expect(phases.at(-1)).toContain('校验');
  });
  it('传输失败取消票据，不能建档或返回成功', async () => {
    mockWx(403);
    call.mockResolvedValueOnce(grant).mockResolvedValueOnce({ cancelled: true });
    await expect(new MediaUpload().run(file, 'school', 'audio', () => undefined)).rejects.toThrow(
      '上传失败',
    );
    expect(call.mock.calls.map((c) => c[1])).toEqual(['prepareUpload', 'cancelUpload']);
  });
  it('等待票据期间取消后不读取或传输文件，并释放已取得票据', async () => {
    const wx = mockWx();
    const upload = new MediaUpload();
    call
      .mockImplementationOnce(async () => {
        upload.cancel();
        return grant;
      })
      .mockResolvedValueOnce({ cancelled: true });
    await expect(upload.run(file, 'school', 'audio', () => undefined)).rejects.toThrow('取消');
    expect(wx.readFile).not.toHaveBeenCalled();
    expect(wx.request).not.toHaveBeenCalled();
    expect(call.mock.calls.at(-1)?.[1]).toBe('cancelUpload');
  });
  it('过期票据和服务端校验失败均不返回可用文件', async () => {
    const wx = mockWx();
    call
      .mockResolvedValueOnce({ ...grant, expiresAt: '2000-01-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ cancelled: true });
    await expect(new MediaUpload().run(file, 'school', 'audio', () => undefined)).rejects.toThrow(
      '失效',
    );
    expect(wx.request).not.toHaveBeenCalled();
    call
      .mockResolvedValueOnce(grant)
      .mockRejectedValueOnce(new Error('invalid media'))
      .mockResolvedValueOnce({ cancelled: true });
    await expect(new MediaUpload().run(file, 'school', 'audio', () => undefined)).rejects.toThrow(
      'invalid media',
    );
    expect(call.mock.calls.at(-1)?.[1]).toBe('cancelUpload');
  });
});
