import { createClassSelectionController } from '../../services/class-selection-controller';

type SelectionLevel = 'schools' | 'grades' | 'classes';
interface Choice {
  _id: string;
  name: string;
}
const emptyLevel = () => ({
  items: [] as Choice[],
  loading: false,
  errorMessage: '',
  hasMore: false,
});

Page({
  data: {
    schools: emptyLevel(),
    grades: emptyLevel(),
    classes: emptyLevel(),
    selectedSchool: null as Choice | null,
    selectedGrade: null as Choice | null,
    selectedClass: null as Choice | null,
    saving: false,
    confirming: false,
    previewMode: false,
    errorMessage: '',
    expandedLevel: 'schools' as SelectionLevel,
    switchMode: false,
  },
  controller: null as ReturnType<typeof createClassSelectionController> | null,
  unsubscribe: null as (() => void) | null,
  alive: true,
  onLoad(options) {
    this.setData({ switchMode: options.mode === 'switch' });
    this.controller = createClassSelectionController();
    this.unsubscribe = this.controller.subscribe((state) => this.setData(state));
    void this.controller.load();
  },
  onUnload() {
    this.alive = false;
    this.unsubscribe?.();
    this.controller?.dispose();
    this.controller = null;
  },
  onExpand(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    const level: unknown = event.currentTarget.dataset.level;
    if (level === 'schools' || level === 'grades' || level === 'classes') {
      if (level === 'grades' && !this.data.selectedSchool) return;
      if (level === 'classes' && !this.data.selectedGrade) return;
      this.setData({ expandedLevel: level });
    }
  },
  onChooseSchool(event: WechatMiniprogram.TouchEvent) {
    const id: unknown = event.currentTarget.dataset.id;
    if (typeof id !== 'string' || this.data.saving) return;
    this.setData({ expandedLevel: 'grades' });
    void this.controller?.chooseSchool(id);
  },
  onChooseGrade(event: WechatMiniprogram.TouchEvent) {
    const id: unknown = event.currentTarget.dataset.id;
    if (typeof id !== 'string' || this.data.saving) return;
    this.setData({ expandedLevel: 'classes' });
    void this.controller?.chooseGrade(id);
  },
  onChooseClass(event: WechatMiniprogram.TouchEvent) {
    const id: unknown = event.currentTarget.dataset.id;
    if (typeof id === 'string' && !this.data.saving) this.controller?.chooseClass(id);
  },
  onLoadMore(event: WechatMiniprogram.TouchEvent) {
    const level: unknown = event.currentTarget.dataset.level;
    if (level === 'schools' || level === 'grades' || level === 'classes') {
      void this.controller?.loadMore(level);
    }
  },
  onRetry(event: WechatMiniprogram.TouchEvent) {
    const level: unknown = event.currentTarget.dataset.level;
    if (level === 'schools' || level === 'grades' || level === 'classes') {
      void this.controller?.retry(level);
    }
  },
  async onSubmit() {
    const controller = this.controller;
    const { selectedSchool, selectedGrade, selectedClass, saving, confirming, previewMode } =
      this.data;
    if (!controller || !selectedSchool || !selectedGrade || !selectedClass) return;
    if (saving || confirming || previewMode) return;
    this.setData({ confirming: true });
    try {
      const answer = await wx.showModal({
        title: this.data.switchMode ? '切换到这个班级？' : '确认加入这个班级？',
        content: `${selectedSchool.name}\n${selectedGrade.name} · ${selectedClass.name}`,
        confirmText: this.data.switchMode ? '确认切换' : '确认加入',
        confirmColor: '#213c49',
      });
      if (!this.alive || this.controller !== controller || !answer.confirm) return;
      const saved = await controller.submit();
      if (!this.alive || this.controller !== controller || !saved) return;
      void wx.switchTab({
        url: this.data.switchMode ? '/pages/class/index' : '/pages/night-talk/index',
      });
    } catch {
      if (this.alive && this.controller === controller)
        this.setData({ errorMessage: '暂时无法确认班级，请重试。' });
    } finally {
      if (this.alive && this.controller === controller) this.setData({ confirming: false });
    }
  },
  onEditProfile() {
    if (this.data.saving || this.data.confirming) return;
    const pages = getCurrentPages();
    if (pages[pages.length - 2]?.route === 'pages/onboarding/identity') {
      void wx.navigateBack();
    } else {
      void wx.navigateTo({ url: '/pages/onboarding/identity?mode=edit' });
    }
  },
});
