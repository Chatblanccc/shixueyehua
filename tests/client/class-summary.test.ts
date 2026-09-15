import { describe, expect, it } from 'vitest';
import { ClassSummaryController } from '../../miniprogram/services/class-summary.service';
import { createUserStore } from '../../miniprogram/stores/user.store';
import type { CurrentClass } from '../../shared';

const summary = (suffix: string): CurrentClass => ({
  school: { _id: `s${suffix}`, name: '测试学校' },
  grade: { _id: `g${suffix}`, schoolId: `s${suffix}`, name: '测试年级' },
  class: {
    _id: `c${suffix}`,
    schoolId: `s${suffix}`,
    gradeId: `g${suffix}`,
    joinMode: 'free',
    name: '测试班级',
  },
});
function storeFor(suffix: string) {
  const store = createUserStore();
  store.user = {
    _id: 'test_user',
    nickname: '测试',
    identity: 'student',
    role: 'user',
    status: 'active',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    currentSchoolId: `s${suffix}`,
    currentGradeId: `g${suffix}`,
    currentClassId: `c${suffix}`,
  };
  return store;
}
describe('当前班级与范围缓存', () => {
  it('切班后旧请求不覆盖新名称，新的请求也不会被旧finally清理', async () => {
    const store = storeFor('a');
    const pending: Array<(value: CurrentClass) => void> = [];
    const controller = new ClassSummaryController(
      store,
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    );
    const old = controller.refresh();
    await Promise.resolve();
    store.user = storeFor('b').user;
    store.scopeRevision++;
    store.currentClass = null;
    const next = controller.refresh();
    await Promise.resolve();
    pending[0]?.(summary('a'));
    await old;
    expect(store.currentClass).toBeNull();
    expect(store.classLoading).toBe(true);
    pending[1]?.(summary('b'));
    await next;
    expect(store.currentClass).toMatchObject({ class: { _id: 'cb' } });
    expect(store.classLoading).toBe(false);
  });
  it('响应层级与用户当前选择不一致时拒绝，真实停用班级提示重选', async () => {
    const store = storeFor('a');
    const wrong = new ClassSummaryController(store, async () => summary('b'));
    await wrong.refresh();
    expect(store.currentClass).toBeNull();
    expect(store.classError).toBeTruthy();
    const inactive = new ClassSummaryController(store, async () => null);
    await inactive.refresh(true);
    expect(store.classError).toContain('重新选择');
  });
});
