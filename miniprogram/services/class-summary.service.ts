import { runInAction } from 'mobx-miniprogram';
import type { CurrentClass } from '../generated/shared';
import type { UserStore } from '../stores/user.store';
import { userStore } from '../stores/user.store';
import { classService } from './class.service';
import { CloudClientError } from './cloud-client';

/** Scope changes immediately clear the old summary and invalidate every pending response. */
export class ClassSummaryController {
  private inFlight: { key: string; promise: Promise<void> } | null = null;
  private sequence = 0;
  constructor(
    private store: UserStore,
    private read: () => Promise<CurrentClass | null>,
  ) {}

  refresh(force = false): Promise<void> {
    const user = this.store.user;
    if (!user) return Promise.resolve();
    const key = [
      user._id,
      this.store.scopeRevision,
      user.currentSchoolId,
      user.currentGradeId,
      user.currentClassId,
    ].join('|');
    if (!force && this.inFlight?.key === key) return this.inFlight.promise;
    if (!force && this.store.currentClass && !this.store.classError) return Promise.resolve();
    const sequence = ++this.sequence;
    const scope = this.store.scopeRevision;
    const valid = () =>
      sequence === this.sequence &&
      scope === this.store.scopeRevision &&
      user._id === this.store.user?._id;
    runInAction(() => {
      this.store.classLoading = true;
      this.store.classError = '';
    });
    const promise: Promise<void> = Promise.resolve().then(async () => {
      try {
        const current = await this.read();
        if (!valid()) return;
        if (
          current &&
          (current.school._id !== user.currentSchoolId ||
            current.grade._id !== user.currentGradeId ||
            current.class._id !== user.currentClassId)
        )
          throw new CloudClientError('INVALID_RESPONSE', 'class-summary');
        runInAction(() => {
          this.store.currentClass = current;
          this.store.classError =
            !current && user.currentClassId ? '当前班级已不可用，请重新选择' : '';
        });
      } catch (error: unknown) {
        if (!valid()) return;
        runInAction(() => {
          this.store.currentClass = null;
          this.store.classError =
            error instanceof CloudClientError ? error.message : '班级信息暂时无法加载，请重试';
        });
      } finally {
        if (valid())
          runInAction(() => {
            this.store.classLoading = false;
          });
        if (this.inFlight?.promise === promise) this.inFlight = null;
      }
    });
    this.inFlight = { key, promise };
    return promise;
  }
}
const summary = new ClassSummaryController(userStore, classService.getCurrentClass);
export const refreshCurrentClass = (force = false): Promise<void> => summary.refresh(force);
