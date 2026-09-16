import { bindUserStore, unbindUserStore } from '../../components/session-page/bindings';
import { refreshCurrentClass } from '../../services/class-summary.service';
import { userStore } from '../../stores/user.store';
import { requireSession } from '../../services/session.service';
import { letterService } from '../../services/letter.service';
import {
  readLetterEditor,
  saveLetterEditor,
  clearLetterEditor,
} from '../../services/letter-editor-cache';
import { parseLetterFields } from '../../generated/shared';
import type { OwnLetter, LetterFields } from '../../generated/shared';
const empty = (): LetterFields => ({
  title: '',
  content: '',
  recipientType: 'child',
  visibility: 'private',
  imageFileIds: [],
});
const requestKey = () => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const recipients = ['child', 'parent', 'teacher', 'classmate', 'future_self', 'other'] as const;
const scopes = ['private', 'class', 'school'] as const;

Page({
  data: {
    loading: true,
    user: null,
    isOnboarded: false,
    isAdmin: false,
    previewMode: false,
    editor: empty(),
    editorOpen: false,
    dirty: false,
    letterId: '',
    revision: 0,
    requestKey: '',
    letters: [] as OwnLetter[],
    nextCursor: '',
    busy: false,
    listLoading: false,
    letterError: '',
    recipientNames: ['孩子', '父母', '老师', '同学', '未来的自己', '其他'],
    recipientIndex: 0,
    scopeNames: ['仅自己与管理员', '本班精选', '全校精选'],
    scopeIndex: 0,
  },
  owner: '',
  alive: true,
  listRequest: 0,
  onLoad() {
    bindUserStore(this);
  },
  onShow() {
    void requireSession().then((allowed) => {
      if (allowed && userStore.user) {
        void refreshCurrentClass(true);
        if (this.owner !== userStore.user._id) {
          this.owner = userStore.user._id;
          this.setData({
            editor: empty(),
            editorOpen: false,
            letterId: '',
            revision: 0,
            dirty: false,
            requestKey: requestKey(),
            letters: [],
            nextCursor: '',
          });
          try {
            const cache = readLetterEditor(this.owner);
            if (cache)
              this.setData({
                editor: cache.fields,
                editorOpen: true,
                letterId: cache.letterId,
                revision: cache.revision,
                requestKey: cache.requestKey,
                dirty: true,
                recipientIndex: recipients.indexOf(cache.fields.recipientType),
                scopeIndex: scopes.indexOf(cache.fields.visibility),
              });
          } catch {
            this.setData({
              letterError: '本机草稿读取失败，请勿清除缓存；可从下方重新打开已保存家书',
            });
          }
        }
        void this.loadLetters();
      }
    });
  },
  onUnload() {
    this.alive = false;
    unbindUserStore(this);
  },
  async loadLetters(more = false) {
    if (more && this.data.listLoading) return;
    const request = ++this.listRequest;
    const owner = this.owner;
    this.setData({ listLoading: true });
    try {
      const result = await letterService.list(more ? this.data.nextCursor : undefined);
      if (this.alive && owner === this.owner && request === this.listRequest)
        this.setData({
          letters: more ? [...this.data.letters, ...result.items] : result.items,
          nextCursor: result.nextCursor ?? '',
        });
    } catch (e) {
      if (this.alive && owner === this.owner && request === this.listRequest)
        this.setData({ letterError: e instanceof Error ? e.message : '读取失败，请重试' });
    } finally {
      if (this.alive && request === this.listRequest) this.setData({ listLoading: false });
    }
  },
  onMore() {
    if (this.data.nextCursor) void this.loadLetters(true);
  },
  onRetry() {
    this.setData({ letterError: '' });
    void this.loadLetters();
  },
  remember() {
    this.setData({ dirty: true });
    wx.enableAlertBeforeUnload({ message: '还有未提交的家书，已尝试保存在本机' });
    try {
      saveLetterEditor(this.owner, {
        letterId: this.data.letterId,
        revision: this.data.revision,
        requestKey: this.data.requestKey,
        fields: this.data.editor,
      });
    } catch {
      this.setData({ letterError: '本机存储失败，请留在本页并点击保存草稿' });
    }
  },
  onTitle(e: WechatMiniprogram.Input) {
    this.setData({ 'editor.title': e.detail.value });
    this.remember();
  },
  onContent(e: WechatMiniprogram.Input) {
    this.setData({ 'editor.content': e.detail.value });
    this.remember();
  },
  onRecipient(e: WechatMiniprogram.PickerChange) {
    const i = Number(e.detail.value);
    const value = recipients[i];
    if (value) {
      this.setData({ 'editor.recipientType': value, recipientIndex: i });
      this.remember();
    }
  },
  onScope(e: WechatMiniprogram.PickerChange) {
    const i = Number(e.detail.value);
    const value = scopes[i];
    if (value) {
      this.setData({ 'editor.visibility': value, scopeIndex: i });
      this.remember();
    }
  },
  async onNew() {
    if (this.data.busy) return;
    if (
      this.data.dirty &&
      !(await wx.showModal({ title: '新建家书', content: '当前未保存的编辑会被替换，是否继续？' }))
        .confirm
    )
      return;
    this.setData({
      editor: empty(),
      editorOpen: true,
      letterId: '',
      revision: 0,
      requestKey: requestKey(),
      recipientIndex: 0,
      scopeIndex: 0,
      letterError: '',
      dirty: false,
    });
    this.remember();
  },
  async onEdit(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id: unknown = e.currentTarget.dataset.id;
    const letter = this.data.letters.find((v) => v._id === id);
    if (!letter || !['draft', 'rejected'].includes(letter.reviewStatus)) return;
    if (
      this.data.dirty &&
      !(await wx.showModal({ title: '切换家书', content: '当前未保存编辑会被替换，是否继续？' }))
        .confirm
    )
      return;
    this.setData({
      editor: parseLetterFields(letter),
      letterId: letter._id,
      revision: letter.revision,
      editorOpen: true,
      dirty: false,
      requestKey: requestKey(),
      recipientIndex: recipients.indexOf(letter.recipientType),
      scopeIndex: scopes.indexOf(letter.visibility),
      letterError: '',
    });
    clearLetterEditor(this.owner);
    wx.disableAlertBeforeUnload();
  },
  async saveCurrent() {
    const result = this.data.letterId
      ? await letterService.update(this.data.letterId, this.data.revision, this.data.editor)
      : await letterService.create(this.data.requestKey, this.data.editor);
    if (!this.alive) return result;
    this.setData({ letterId: result._id, revision: result.revision, dirty: false });
    clearLetterEditor(this.owner);
    wx.disableAlertBeforeUnload();
    return result;
  },
  async onSave() {
    if (this.data.busy) return;
    this.setData({ busy: true, letterError: '' });
    try {
      await this.saveCurrent();
      await this.loadLetters();
      wx.showToast({ title: '草稿已保存', icon: 'success' });
    } catch (e) {
      this.setData({ letterError: e instanceof Error ? e.message : '保存失败，请重试' });
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  async onSubmit() {
    if (this.data.busy) return;
    this.setData({ busy: true, letterError: '' });
    try {
      const d = await this.saveCurrent();
      await letterService.transition(d._id, d.revision, 'submit');
      this.setData({ editorOpen: false });
      await this.loadLetters();
      wx.showToast({ title: '已进入待审核', icon: 'success' });
    } catch (e) {
      this.setData({ letterError: e instanceof Error ? e.message : '提交失败，草稿已保留' });
      await this.loadLetters();
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
  async onTransition(e: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id: unknown = e.currentTarget.dataset.id,
      action: unknown = e.currentTarget.dataset.action;
    const d = this.data.letters.find((v) => v._id === id);
    if (!d || (action !== 'withdraw' && action !== 'delete')) return;
    if (
      !(
        await wx.showModal({
          title: action === 'delete' ? '删除家书' : '撤回家书',
          content: action === 'delete' ? '确定删除这封家书？' : '撤回后可重新编辑并提交。',
        })
      ).confirm
    )
      return;
    this.setData({ busy: true, letterError: '' });
    try {
      await letterService.transition(d._id, d.revision, action);
      if (this.data.letterId === d._id) {
        clearLetterEditor(this.owner);
        this.setData({ editorOpen: false, dirty: false, letterId: '' });
        wx.disableAlertBeforeUnload();
      }
      await this.loadLetters();
    } catch (e) {
      this.setData({ letterError: e instanceof Error ? e.message : '操作失败' });
    } finally {
      if (this.alive) this.setData({ busy: false });
    }
  },
});
