import { createProfileController } from '../../services/profile-controller';

Page({
  data: {
    identity: '',
    nickname: '',
    avatarPreset: 'moon',
    loading: true,
    saving: false,
    errorMessage: '',
    previewMode: false,
    editMode: false,
  },
  controller: null as ReturnType<typeof createProfileController> | null,
  unsubscribe: null as (() => void) | null,
  alive: true,
  onLoad(options) {
    const editMode = options.mode === 'edit';
    this.setData({ editMode });
    this.controller = createProfileController();
    this.unsubscribe = this.controller.subscribe((state) => this.setData(state));
    void this.controller.load({ edit: editMode });
  },
  onUnload() {
    this.alive = false;
    this.unsubscribe?.();
    this.controller?.dispose();
    this.controller = null;
  },
  onChooseIdentity(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    const identity: unknown = event.currentTarget.dataset.identity;
    if (identity === 'student' || identity === 'parent' || identity === 'teacher') {
      this.controller?.setIdentity(identity);
    }
  },
  onNicknameInput(event: WechatMiniprogram.Input) {
    this.controller?.setNickname(event.detail.value);
  },
  onChooseAvatar(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    const preset: unknown = event.currentTarget.dataset.preset;
    if (preset === 'moon' || preset === 'book' || preset === 'bamboo') {
      this.controller?.setAvatarPreset(preset);
    }
  },
  onRetry() {
    void this.controller?.load({ edit: this.data.editMode });
  },
  async onSubmit() {
    const controller = this.controller;
    if (!controller || this.data.saving) return;
    const saved = await controller.submit();
    if (!saved || !this.alive || this.controller !== controller) return;
    if (this.data.editMode) {
      if (getCurrentPages().length > 1) void wx.navigateBack();
      else void wx.switchTab({ url: '/pages/profile/index' });
      return;
    }
    void wx.navigateTo({ url: '/pages/class-select/index' });
  },
  onPreviewClasses() {
    if (this.data.previewMode) void wx.navigateTo({ url: '/pages/class-select/index' });
  },
});
