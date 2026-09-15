import { bindUserStore, unbindUserStore } from '../../../components/session-page/bindings';
import { requireAdminSession } from '../../../services/session.service';
import { userStore } from '../../../stores/user.store';

const destinations: readonly string[] = [
  'audio-create',
  'audio-manage',
  'letter-review',
  'class-manage',
  'admin-manage',
  'settings',
];

Page({
  data: { allowed: false, user: null },
  onLoad() {
    bindUserStore(this);
  },
  async onShow() {
    this.setData({ allowed: await requireAdminSession() });
  },
  onUnload() {
    unbindUserStore(this);
  },
  async onNavigate(event: WechatMiniprogram.TouchEvent) {
    const destination: unknown = event.currentTarget.dataset.route;
    if (typeof destination !== 'string' || !destinations.includes(destination)) return;
    if (!(await requireAdminSession())) return;
    if (destination === 'admin-manage' && userStore.user?.role !== 'super_admin') return;
    void wx.navigateTo({ url: `/package-admin/pages/${destination}/index` });
  },
  onReturn() {
    void wx.switchTab({ url: '/pages/profile/index' });
  },
});
