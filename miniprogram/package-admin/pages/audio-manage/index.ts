import { createAdminPage, authorizeAdminPage, adminPageAction } from '../../admin-page';
import { adminAudioService, mediaPath } from '../../../services/admin-audio.service';
import { localModeEnabled } from '../../../services/local-mode';
import { playerService } from '../../../services/player.service';
import type { ManagedAudio } from '../../../generated/shared';
const base = createAdminPage();
Page({
  ...base,
  data: {
    ...base.data!,
    items: [] as ManagedAudio[],
    status: 'draft' as 'draft' | 'published' | 'offline',
    cursor: '',
    busy: false,
    localExperience: false,
    error: '',
  },
  alive: true,
  preview: null as WechatMiniprogram.InnerAudioContext | null,
  onLoad(options: Record<string, string>) {
    base.onLoad?.call(this, options);
    this.setData({ localExperience: localModeEnabled() });
  },
  async onShow() {
    if (await authorizeAdminPage(this)) await this.reload();
  },
  onHide() {
    this.preview?.stop();
    this.setData({ items: [], cursor: '' });
    base.onHide?.call(this);
  },
  onUnload() {
    this.alive = false;
    this.preview?.destroy();
    base.onUnload?.call(this);
  },
  async reload() {
    await this.load(false);
  },
  async onLoadMore() {
    if (this.data.cursor) await this.load(true);
  },
  async load(append: boolean) {
    if (this.data.busy || !this.alive) return;
    this.setData({ busy: true, error: '' });
    try {
      await adminPageAction(
        this,
        async () => {
          const schoolId = this.data.user?.adminSchoolId ?? this.data.user?.currentSchoolId;
          if (!schoolId) throw new Error('请先选择管理学校');
          return adminAudioService.list(
            schoolId,
            this.data.status,
            append ? this.data.cursor : undefined,
          );
        },
        (result) => {
          if (this.alive)
            this.setData({
              items: append
                ? [
                    ...this.data.items,
                    ...result.items.filter((a) => !this.data.items.some((b) => a._id === b._id)),
                  ]
                : result.items,
              cursor: result.nextCursor ?? '',
            });
        },
      );
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  async onFilter(event: WechatMiniprogram.BaseEvent) {
    const status: unknown = event.currentTarget.dataset.status;
    if (this.data.busy || (status !== 'draft' && status !== 'published' && status !== 'offline'))
      return;
    this.setData({ status, items: [], cursor: '' });
    await this.reload();
  },
  onCreate() {
    void wx.navigateTo({ url: '/package-admin/pages/audio-create/index' });
  },
  onEdit(event: WechatMiniprogram.BaseEvent) {
    const id: unknown = event.currentTarget.dataset.id;
    if (
      typeof id === 'string' &&
      this.data.items.some((a) => a._id === id && a.status !== 'published')
    )
      void wx.navigateTo({
        url: `/package-admin/pages/audio-create/index?audioId=${encodeURIComponent(id)}`,
      });
  },
  async onTransition(event: WechatMiniprogram.BaseEvent) {
    const id: unknown = event.currentTarget.dataset.id;
    const action: unknown = event.currentTarget.dataset.action;
    if (
      this.data.busy ||
      typeof id !== 'string' ||
      !this.data.items.some((a) => a._id === id) ||
      (action !== 'publish' && action !== 'offline' && action !== 'delete')
    )
      return;
    const confirmed = await wx.showModal({
      title:
        action === 'publish'
          ? '发布这期夜话？'
          : action === 'offline'
            ? '下架这期夜话？'
            : '删除这期夜话？',
      content:
        action === 'publish'
          ? '发布后，所选范围内的听众即可收听。'
          : action === 'offline'
            ? '下架后听众无法再打开，可编辑后重新发布。'
            : '节目将从列表移除并停止提供收听，操作记录仍保留。',
      confirmText: action === 'publish' ? '发布' : action === 'offline' ? '下架' : '删除',
    });
    if (!confirmed.confirm || !this.alive) return;
    this.setData({ busy: true });
    try {
      await adminPageAction(
        this,
        () => adminAudioService.transition(id, action),
        () => {
          if (action !== 'publish') playerService.markUnavailable(id);
          this.preview?.stop();
          if (this.alive) {
            this.setData({ items: this.data.items.filter((a) => a._id !== id) });
            void wx.showToast({ title: '操作成功', icon: 'success' });
          }
        },
      );
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  async onPreviewAudio(event: WechatMiniprogram.BaseEvent) {
    const id: unknown = event.currentTarget.dataset.id;
    if (typeof id !== 'string') return;
    await adminPageAction(
      this,
      () => adminAudioService.detail(id),
      (audio) => {
        if (!audio.mediaUrl || !this.alive) return;
        playerService.pause();
        this.preview?.destroy();
        this.preview = wx.createInnerAudioContext();
        this.preview.onError(() => {
          if (this.alive) this.setData({ error: '试听失败，请重试' });
        });
        this.preview.src = mediaPath(audio.mediaUrl);
        this.preview.play();
      },
    );
  },
  onStopPreview() {
    this.preview?.stop();
  },
});
