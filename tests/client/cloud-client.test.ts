import { describe, expect, it, vi } from 'vitest';
import { createCloudClient } from '../../miniprogram/services/cloud-client';
import { parseLoginResult } from '../../shared';

describe('云调用边界', () => {
  it('不展示云服务原始错误或堆栈，也不自动重试写请求', async () => {
    const transport = vi.fn().mockResolvedValue({
      success: false,
      requestId: 'server-1',
      error: { code: 'FORBIDDEN', message: 'SECRET stack trace' },
    });
    const call = createCloudClient(transport);
    await expect(
      call('adminAudioApi', 'publish', (value) => value, { audioId: 'x' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: '当前账号没有此操作权限',
      requestId: 'server-1',
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('拒绝坏响应，不把形似成功的数据当作登录', async () => {
    const call = createCloudClient(async () => ({
      success: true,
      data: { user: { role: 'super_admin' }, onboardingStep: 'ready' },
    }));
    await expect(call('authApi', 'login', parseLoginResult)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('网络异常映射稳定文案', async () => {
    const call = createCloudClient(async () => {
      throw new Error('private SDK token');
    });
    await expect(call('authApi', 'login', (value) => value)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: '连接失败，请检查网络后重试',
    });
  });

  it('调用超时会结束等待，迟到结果不产生假成功', async () => {
    vi.useFakeTimers();
    try {
      let finish: (value: unknown) => void = () => undefined;
      const call = createCloudClient(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        100,
      );
      const result = call('authApi', 'login', (value) => value);
      const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      finish({ success: true, data: 'late' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('仅将action/payload/requestId发送，未知错误码不泄漏内部信息', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue({ success: false, error: { code: 'SECRET_FAILURE', message: 'private' } });
    await expect(
      createCloudClient(transport)('authApi', 'login', (value) => value),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(transport.mock.calls[0]?.[0]).toEqual({
      name: 'authApi',
      data: { action: 'login', payload: undefined, requestId: expect.any(String) },
    });
  });
});
