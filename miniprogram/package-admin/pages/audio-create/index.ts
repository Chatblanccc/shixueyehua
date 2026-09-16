import { createAdminPage, authorizeAdminPage, adminPageAction } from '../../admin-page';
import {
  adminAudioService,
  chooseAudio,
  chooseCover,
  MediaUpload,
  sampleMedia,
  mediaPath,
} from '../../../services/admin-audio.service';
import type { SelectedMedia } from '../../../services/admin-audio.service';
import { localModeEnabled } from '../../../services/local-mode';
import { classService } from '../../../services/class.service';
import { playerService } from '../../../services/player.service';
import type { ClassOption, AudioDraftInput } from '../../../generated/shared';
const base = createAdminPage();
Page({
  ...base,
  data: {
    ...base.data!,
    localExperience: false,
    audioId: '',
    title: '',
    description: '',
    speakerName: '',
    speakerTitle: '',
    visibility: 'school' as 'school' | 'classes',
    classIds: [] as string[],
    classes: [] as (ClassOption & { checked: boolean })[],
    audio: null as SelectedMedia | null,
    cover: null as SelectedMedia | null,
    existingDuration: 0,
    busy: false,
    phase: '',
    error: '',
    saved: false,
    dirty: false,
    uploadKind: '' as '' | 'audio' | 'cover',
    durationLabel: '',
    loaded: false,
  },
  upload: null as MediaUpload | null,
  preview: null as WechatMiniprogram.InnerAudioContext | null,
  alive: true,
  revision: 0,
  draftKey: '',
  onLoad(options: { audioId?: string }) {
    base.onLoad?.call(this, options);
    this.draftKey = `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    this.setData({ audioId: options.audioId ?? '', localExperience: localModeEnabled() });
  },
  async onShow() {
    if (!(await authorizeAdminPage(this)) || !this.alive || this.data.loaded) return;
    await this.loadForm();
  },
  onHide() {
    this.preview?.stop();
    base.onHide?.call(this);
  },
  onUnload() {
    this.alive = false;
    this.revision++;
    this.upload?.cancel();
    this.preview?.destroy();
    base.onUnload?.call(this);
  },
  async loadForm() {
    const revision = ++this.revision;
    await adminPageAction(
      this,
      async () => {
        const schoolId = this.data.user?.adminSchoolId ?? this.data.user?.currentSchoolId;
        if (!schoolId) throw new Error('请先选择要管理的学校');
        const classes: ClassOption[] = [];
        let gradeCursor: string | undefined;
        do {
          const grades = await classService.listGrades(schoolId, gradeCursor);
          gradeCursor = grades.nextCursor;
          for (const grade of grades.items) {
            let classCursor: string | undefined;
            do {
              const result = await classService.listClasses(schoolId, grade._id, classCursor);
              classes.push(...result.items);
              classCursor = result.nextCursor;
            } while (classCursor);
          }
        } while (gradeCursor);
        const audio = this.data.audioId ? await adminAudioService.detail(this.data.audioId) : null;
        if (audio?.status === 'published') throw new Error('已发布内容需先下架再编辑');
        return { classes, audio };
      },
      ({ classes, audio }) => {
        if (!this.alive || revision !== this.revision) return;
        this.setData({
          loaded: true,
          classes: classes.map((c) => ({
            ...c,
            checked: audio?.classIds.includes(c._id) ?? false,
          })),
          ...(audio
            ? {
                title: audio.title,
                description: audio.description,
                speakerName: audio.speakerName,
                speakerTitle: audio.speakerTitle,
                visibility: audio.visibility,
                classIds: audio.classIds,
                existingDuration: audio.duration,
                durationLabel: `${Math.round(audio.duration)} 秒`,
                saved: true,
              }
            : {}),
        });
      },
    );
  },
  onField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field: unknown = event.currentTarget.dataset.field;
    if (
      this.data.busy ||
      typeof field !== 'string' ||
      !['title', 'description', 'speakerName', 'speakerTitle'].includes(field)
    )
      return;
    this.setData({ [field]: event.detail.value });
    this.markDirty();
  },
  onVisibility(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (event.detail.value !== 'school' && event.detail.value !== 'classes') return;
    this.setData({ visibility: event.detail.value });
    this.markDirty();
  },
  onClasses(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
    this.setData({
      classIds: event.detail.value,
      classes: this.data.classes.map((c) => ({
        ...c,
        checked: event.detail.value.includes(c._id),
      })),
    });
    this.markDirty();
  },
  markDirty() {
    this.setData({ dirty: true, saved: false, error: '' });
    wx.enableAlertBeforeUnload({ message: '尚有未保存的夜话内容，离开后需要重新填写。' });
  },
  onUseSample() {
    if (!localModeEnabled() || this.data.busy) return;
    const audio = sampleMedia();
    this.setData({ audio, durationLabel: `${Math.round(audio.duration ?? 0)} 秒` });
    this.markDirty();
  },
  async onChooseAudio() {
    await this.selectMedia('audio');
  },
  async onChooseCover() {
    await this.selectMedia('cover');
  },
  async selectMedia(kind: 'audio' | 'cover') {
    if (this.data.busy || !this.data.allowed) return;
    this.setData({ busy: true, error: '', uploadKind: kind, phase: '请选择文件…' });
    try {
      const file = kind === 'audio' ? await chooseAudio() : await chooseCover();
      if (!this.alive) return;
      if (!(await authorizeAdminPage(this))) return;
      const schoolId = this.data.user?.adminSchoolId ?? this.data.user?.currentSchoolId;
      if (!schoolId) throw new Error('没有可用管理学校');
      this.upload = new MediaUpload();
      const result = await this.upload.run(file, schoolId, kind, (phase) => {
        if (this.alive) this.setData({ phase });
      });
      if (!this.alive) return;
      this.setData({
        [kind]: result,
        ...(kind === 'audio' ? { durationLabel: `${Math.round(result.duration ?? 0)} 秒` } : {}),
      });
      this.markDirty();
    } catch (error: unknown) {
      if (this.alive)
        this.setData({
          error: error instanceof Error ? error.message : '文件未选择或上传中断，可重新选择重试',
        });
    } finally {
      if (this.alive) this.setData({ busy: false, phase: '', uploadKind: '' });
      this.upload = null;
    }
  },
  onCancelUpload() {
    this.upload?.cancel();
  },
  async onPreviewAudio() {
    if (this.data.busy) return;
    try {
      playerService.pause();
      let path = this.data.audio?.path;
      if (!path && this.data.audioId) {
        const detail = await adminAudioService.detail(this.data.audioId);
        if (detail.mediaUrl) path = mediaPath(detail.mediaUrl);
      }
      if (!path || !this.alive) throw new Error('请先选择音频');
      this.preview?.destroy();
      this.preview = wx.createInnerAudioContext();
      this.preview.onError(() => {
        if (this.alive) this.setData({ error: '试听失败，请重新选择文件或重试' });
      });
      this.preview.src = path;
      this.preview.play();
    } catch (error: unknown) {
      if (this.alive) this.setData({ error: error instanceof Error ? error.message : '试听失败' });
    }
  },
  onStopPreview() {
    this.preview?.stop();
  },
  async onSave() {
    if (this.data.busy || !this.data.allowed) return;
    if (
      !this.data.title.trim() ||
      !this.data.speakerName.trim() ||
      (!this.data.audio && !this.data.audioId) ||
      (this.data.visibility === 'classes' && this.data.classIds.length === 0)
    ) {
      this.setData({ error: '请填写标题、主讲人，选择音频和可见班级' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      await adminPageAction(
        this,
        async () => {
          const schoolId = this.data.user?.adminSchoolId ?? this.data.user?.currentSchoolId;
          if (!schoolId) throw new Error('没有可用管理学校');
          const metadata = {
            title: this.data.title.trim(),
            description: this.data.description.trim(),
            speakerName: this.data.speakerName.trim(),
            speakerTitle: this.data.speakerTitle.trim(),
            visibility: this.data.visibility,
            classIds: this.data.visibility === 'school' ? [] : this.data.classIds,
          };
          const audio = this.data.audio;
          const cover = this.data.cover ?? undefined;
          if (this.data.audioId)
            return adminAudioService.update(
              {
                ...metadata,
                audioId: this.data.audioId,
                ...(audio?.ticketId ? { audioTicketId: audio.ticketId } : {}),
                ...(cover?.ticketId ? { coverTicketId: cover.ticketId } : {}),
              },
              audio ?? undefined,
              cover,
            );
          if (!audio) throw new Error('请先选择音频');
          const input: AudioDraftInput = {
            ...metadata,
            schoolId,
            audioTicketId: audio.ticketId ?? this.draftKey,
            ...(cover?.ticketId ? { coverTicketId: cover.ticketId } : {}),
          };
          return adminAudioService.create(input, audio, cover);
        },
        (audio) => {
          if (!this.alive) return;
          this.setData({ audioId: audio._id, saved: true, dirty: false });
          wx.disableAlertBeforeUnload();
          void wx.showToast({ title: '草稿已保存', icon: 'success' });
        },
      );
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  onManage() {
    void wx.redirectTo({ url: '/package-admin/pages/audio-manage/index' });
  },
});
