import type { SafetyPlatform } from './content-safety';

/** wx-server-sdk's dynamic OpenAPI surface is narrowed from unknown, never trusted as any. */
export function createWechatSafetyPlatform(getOpenApi: () => unknown): SafetyPlatform {
  const objectLike = (value: unknown): value is object =>
    value !== null && (typeof value === 'object' || typeof value === 'function');
  async function invoke(
    method: 'msgSecCheck' | 'mediaCheckAsync',
    input: unknown,
  ): Promise<unknown> {
    const api = getOpenApi();
    if (!objectLike(api)) throw new Error('Safety API unavailable');
    const security: unknown = Reflect.get(api, 'security');
    if (!objectLike(security)) throw new Error('Safety API unavailable');
    const call: unknown = Reflect.get(security, method);
    if (typeof call !== 'function') throw new Error('Safety API unavailable');
    const response: unknown = await Reflect.apply(call, security, [input]);
    return response;
  }
  return {
    text: (input) => invoke('msgSecCheck', input),
    image: (input) => invoke('mediaCheckAsync', input),
  };
}
