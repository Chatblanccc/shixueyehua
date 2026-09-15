import type {
  AvatarPreset,
  UpdateProfileInput,
  UserIdentity,
  UserProfile,
} from '../generated/shared';
import { USER_IDENTITIES } from '../generated/shared';
import { userStore } from '../stores/user.store';
import { authService } from './auth.service';
import { CloudClientError } from './cloud-client';
import { ensureUserSession, mutateSession } from './session.service';

export interface ProfileSnapshot {
  identity: '' | UserIdentity;
  nickname: string;
  avatarPreset: AvatarPreset;
  loading: boolean;
  saving: boolean;
  errorMessage: string;
  previewMode: boolean;
}
type Draft = Pick<ProfileSnapshot, 'identity' | 'nickname' | 'avatarPreset'>;
export interface ProfilePort {
  getUser(): UserProfile | null;
  previewMode: boolean;
  ensureUser(): Promise<boolean>;
  save(input: UpdateProfileInput): Promise<unknown>;
}
/** Drafts remain in memory only, scoped by account; preview never writes an account. */
export const profileDrafts = new Map<string, Draft>();
export class ProfileController {
  private state: ProfileSnapshot;
  private listeners = new Set<(state: ProfileSnapshot) => void>();
  private alive = true;
  private revision = 0;
  private owner = '';
  constructor(
    private port: ProfilePort,
    private drafts = profileDrafts,
  ) {
    this.state = {
      identity: '',
      nickname: '',
      avatarPreset: 'moon',
      loading: false,
      saving: false,
      errorMessage: '',
      previewMode: port.previewMode,
    };
  }
  subscribe(listener: (state: ProfileSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => this.listeners.delete(listener);
  }
  private emit(): void {
    if (this.alive) for (const listener of this.listeners) listener({ ...this.state });
  }
  async load(_options: { edit: boolean } = { edit: false }): Promise<void> {
    const revision = ++this.revision;
    this.state.loading = true;
    this.state.errorMessage = '';
    this.emit();
    try {
      if (!this.port.previewMode && !(await this.port.ensureUser())) return;
      if (!this.alive || revision !== this.revision) return;
      const user = this.port.getUser();
      this.owner = user?._id ?? 'local-preview';
      const draft = this.drafts.get(this.owner) ?? {
        identity: user?.identity ?? '',
        nickname: user?.nickname ?? '',
        avatarPreset: user?.avatarPreset ?? 'moon',
      };
      Object.assign(this.state, draft);
      if (user?.status === 'disabled') this.state.errorMessage = '当前账号暂时无法修改资料';
    } catch (error: unknown) {
      if (this.alive && revision === this.revision) this.state.errorMessage = this.message(error);
    } finally {
      if (this.alive && revision === this.revision) {
        this.state.loading = false;
        this.emit();
      }
    }
  }
  private saveDraft(): void {
    if (!this.owner) return;
    this.drafts.set(this.owner, {
      identity: this.state.identity,
      nickname: this.state.nickname,
      avatarPreset: this.state.avatarPreset,
    });
    this.state.errorMessage = '';
    this.emit();
  }
  setIdentity(identity: UserIdentity): void {
    if (!this.alive || this.state.saving || !USER_IDENTITIES.includes(identity)) return;
    this.state.identity = identity;
    this.saveDraft();
  }
  setNickname(nickname: string): void {
    if (!this.alive || this.state.saving) return;
    this.state.nickname = nickname;
    this.saveDraft();
  }
  setAvatarPreset(avatarPreset: AvatarPreset): void {
    if (!this.alive || this.state.saving || !['moon', 'book', 'bamboo'].includes(avatarPreset))
      return;
    this.state.avatarPreset = avatarPreset;
    this.saveDraft();
  }
  async submit(): Promise<boolean> {
    if (!this.alive || this.state.saving || this.state.loading) return false;
    if (!this.state.identity) {
      this.state.errorMessage = '请先选择学生、家长或教师身份';
      this.emit();
      return false;
    }
    if (this.state.nickname.trim().length > 80) {
      this.state.errorMessage = '昵称最多 80 个字符';
      this.emit();
      return false;
    }
    if (this.port.previewMode) {
      this.state.errorMessage = '资料已保留在本次预览中，云服务启用后即可保存';
      this.emit();
      return false;
    }
    if (!this.port.getUser() || this.port.getUser()?._id !== this.owner) {
      this.state.errorMessage = '登录状态已变化，请重新进入';
      this.emit();
      return false;
    }
    const revision = this.revision;
    this.state.saving = true;
    this.state.errorMessage = '';
    this.emit();
    try {
      await this.port.save({
        identity: this.state.identity,
        nickname: this.state.nickname.trim(),
        avatarPreset: this.state.avatarPreset,
      });
      if (!this.alive || revision !== this.revision) return false;
      this.drafts.delete(this.owner);
      return true;
    } catch (error: unknown) {
      if (this.alive && revision === this.revision) this.state.errorMessage = this.message(error);
      return false;
    } finally {
      if (this.alive && revision === this.revision) {
        this.state.saving = false;
        this.emit();
      }
    }
  }
  private message(error: unknown): string {
    return error instanceof CloudClientError ? error.message : '资料暂时无法保存，请重试';
  }
  dispose(): void {
    this.alive = false;
    this.revision++;
    this.listeners.clear();
  }
}
export const createProfileController = () =>
  new ProfileController({
    getUser: () => userStore.user,
    previewMode: userStore.previewMode,
    ensureUser: ensureUserSession,
    save: (input) => mutateSession(() => authService.updateProfile(input)),
  });
