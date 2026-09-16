import { mkdir, writeFile } from 'node:fs/promises';
import automator from 'miniprogram-automator';
import type { InputElement } from 'miniprogram-automator/out/Element';
import { isRecord } from '../shared';
const output = 'artifacts/local-experience';
await mkdir(output, { recursive: true });
const app = await automator.launch({
  cliPath:
    process.env.WECHAT_DEVTOOLS_CLI ?? '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  projectPath: process.cwd(),
  timeout: 45000,
});
const errors: string[] = [];
const checks: string[] = [];
app.on('exception', (error: unknown) => errors.push(String(error)));
let baseline: unknown;
let editorBaseline: unknown;
let imageFixturePath = '';
let savedImagePath = '';
const editorKey = 'shixue-letter-editor-local-demo-listener';
async function waitForRoute(route: string) {
  for (let i = 0; i < 60; i++) {
    const current: unknown = await app.evaluate(
      'function () { var p = getCurrentPages(); return p.length ? p[p.length-1].route : ""; }',
    );
    if (current === route) {
      const page = await app.currentPage();
      if (!page) throw Error('页面不存在');
      await page.waitFor(600);
      return page;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(`未进入 ${route}`);
}
async function state() {
  const page = await app.currentPage();
  if (!page) throw Error('页面不存在');
  const data: unknown = await page.data();
  if (!isRecord(data)) throw Error('状态无效');
  return data;
}
async function tap(selector: string) {
  const page = await app.currentPage();
  if (!page) throw Error('页面不存在');
  await page.waitFor(selector);
  const element = await page.$(selector);
  if (!element) throw Error(selector);
  const offset = await element.offset();
  await app.pageScrollTo(Math.max(0, offset.top - 100));
  await page.waitFor(200);
  await element.tap();
  await page.waitFor(500);
}
try {
  await app.reLaunch('/pages/launch/index');
  await new Promise((r) => setTimeout(r, 1000));
  const initial = await state();
  if (initial.previewMode === true) await tap('#preview-entry');
  await waitForRoute('pages/night-talk/index');
  const night = await state();
  if (!night.localExperience || !isRecord(night.featured)) throw Error('没有实际本地节目');
  baseline = await app.callWxMethod('getStorageSync', 'shixue-local-data-v1');
  editorBaseline = await app.callWxMethod('getStorageSync', editorKey);
  checks.push('明确进入本地模式并显示节目');
  await app.screenshot({ path: `${output}/night-talk.png` });
  await tap('#featured-audio');
  await waitForRoute('pages/audio-detail/index');
  await tap('#audio-play');
  await new Promise((r) => setTimeout(r, 3500));
  const playing = await state();
  if (
    !isRecord(playing.playerState) ||
    playing.playerState.status !== 'playing' ||
    !(Number(playing.playerState.currentTime) > 0)
  )
    throw Error(`实际音频未播放: ${JSON.stringify(playing.playerState)}`);
  checks.push('实际本地音频播放且时间推进');
  await tap('#audio-play');
  await tap('#audio-favorite');
  await app.screenshot({ path: `${output}/audio-detail.png` });
  await app.switchTab('/pages/profile/index');
  await waitForRoute('pages/profile/index');
  await tap('#profile-favorites-entry');
  await waitForRoute('pages/audio-favorites/index');
  const favorites = await state();
  if (
    !isRecord(favorites.audioList) ||
    !Array.isArray(favorites.audioList.items) ||
    favorites.audioList.items.length === 0
  )
    throw Error('收藏未保存');
  checks.push('收藏列表显示实际收藏');
  await app.switchTab('/pages/profile/index');
  await waitForRoute('pages/profile/index');
  if ((await state()).isAdmin !== true) {
    await tap('#switch-demo-role');
    await waitForRoute('pages/night-talk/index');
  }
  await app.navigateTo('/package-admin/pages/audio-create/index');
  const form = await waitForRoute('package-admin/pages/audio-create/index');
  await form.waitFor('#audio-title');
  for (let i = 0; i < 20 && (await form.data('loaded')) !== true; i++) await form.waitFor(200);
  await ((await form.$('#audio-title')) as InputElement).input('自动验收：本地发布流程');
  await ((await form.$('#audio-speaker')) as InputElement).input('体验主讲人');
  await tap('#use-sample-audio');
  await tap('#save-audio-draft');
  const saved = await state();
  if (saved.saved !== true || typeof saved.audioId !== 'string')
    throw Error(`草稿未保存: ${JSON.stringify(saved)}`);
  const audioId = saved.audioId;
  checks.push('真实表单输入与草稿保存');
  await app.screenshot({ path: `${output}/audio-create.png` });
  await tap('#go-audio-manage');
  const manage = await waitForRoute('package-admin/pages/audio-manage/index');
  await manage.waitFor(800);
  // Native confirmation response is simulated; the page method and service writes are real local code.
  await app.mockWxMethod('showModal', { confirm: true, cancel: false });
  await tap(`button[data-id="${audioId}"][data-action="publish"]`);
  await app.restoreWxMethod('showModal');
  await app.switchTab('/pages/night-talk/index');
  await waitForRoute('pages/night-talk/index');
  const published = await state();
  if (!isRecord(published.featured) || published.featured._id !== audioId)
    throw Error('发布未显示在首页');
  checks.push('发布后听众首页显示新节目（原生确认框自动应答）');
  await app.navigateTo('/package-admin/pages/audio-manage/index');
  await waitForRoute('package-admin/pages/audio-manage/index');
  await tap('button[data-status="published"]');
  await app.screenshot({ path: `${output}/audio-manage.png` });
  await app.mockWxMethod('showModal', { confirm: true, cancel: false });
  await tap(`button[data-id="${audioId}"][data-action="offline"]`);
  await app.restoreWxMethod('showModal');
  await app.switchTab('/pages/night-talk/index');
  await waitForRoute('pages/night-talk/index');
  const offline = await state();
  if (isRecord(offline.featured) && offline.featured._id === audioId)
    throw Error('下架后节目仍可见');
  checks.push('下架后首页不再展示');
  await app.switchTab('/pages/letters/index');
  await waitForRoute('pages/letters/index');
  await app.screenshot({ path: `${output}/letters-home.png` });
  await app.callWxMethod('removeStorageSync', editorKey);
  await app.mockWxMethod('showModal', { confirm: true, cancel: false });
  await tap('#new-letter');
  const letters = await waitForRoute('pages/write-letter/index');
  await ((await letters.$('#letter-title')) as InputElement).input('给未来的自己');
  await ((await letters.$('#letter-content')) as InputElement).input(
    '希望未来的你仍然记得今天的努力，认真学习，热爱生活，也珍惜身边每一个关心你的人。',
  );
  await tap('#save-letter');
  const letterDraft = await state();
  const letterId = letterDraft.letterId;
  if (typeof letterId !== 'string' || !letterId || letterDraft.dirty !== false)
    throw Error(`家书草稿未保存: ${JSON.stringify(letterDraft)}`);
  checks.push('家书真实输入并保存草稿');
  await letters.waitFor(1600);
  await app.screenshot({ path: `${output}/letter-draft.png` });
  const fixture: unknown = await app.evaluate(
    'function () { var p = wx.env.USER_DATA_PATH + "/letter-test-image.png"; var fs = wx.getFileSystemManager(); fs.copyFileSync("/assets/tabbar/letter-active.png", p); return {path:p, size:fs.statSync(p).size}; }',
  );
  if (!isRecord(fixture) || typeof fixture.path !== 'string') throw Error('图片夹具未准备');
  imageFixturePath = fixture.path;
  await app.mockWxMethod('chooseMedia', {
    type: 'image',
    tempFiles: [{ tempFilePath: fixture.path, size: fixture.size, fileType: 'image' }],
  });
  await tap('#add-letter-image');
  for (let i = 0; i < 50 && (await state()).busy; i++) await letters.waitFor(200);
  await app.restoreWxMethod('chooseMedia');
  const attached = await state();
  if (
    !isRecord(attached.editor) ||
    !Array.isArray(attached.editor.imageFileIds) ||
    attached.editor.imageFileIds.length !== 1 ||
    !Array.isArray(attached.imageUrls) ||
    typeof attached.imageUrls[0] !== 'string'
  )
    throw Error(`图片未保存: ${JSON.stringify(attached)}`);
  savedImagePath = attached.imageUrls[0];
  await app.reLaunch(`/pages/write-letter/index?id=${encodeURIComponent(letterId)}`);
  const reopened = await waitForRoute('pages/write-letter/index');
  const restored = await state();
  if (
    !isRecord(restored.editor) ||
    !Array.isArray(restored.editor.imageFileIds) ||
    restored.editor.imageFileIds.length !== 1 ||
    !Array.isArray(restored.imageUrls) ||
    restored.imageUrls[0] !== savedImagePath
  )
    throw Error('重开后图片草稿未恢复');
  checks.push('图片实际压缩与本机保存，重开恢复附件（选图器使用包内图片夹具）');
  await reopened.waitFor(500);
  await app.screenshot({ path: `${output}/letter-image-draft.png` });
  await tap('#submit-letter');
  const myLetters = await waitForRoute('pages/my-letters/index');
  const submitted = await state();
  if (
    !Array.isArray(submitted.letters) ||
    !submitted.letters.some(
      (v: unknown) => isRecord(v) && v._id === letterId && v.reviewStatus === 'pending',
    )
  )
    throw Error(`家书未进入待审核: ${JSON.stringify(submitted)}`);
  checks.push('家书本地提交进入待审核（非微信内容审核）');
  await myLetters.waitFor(1600);
  await app.screenshot({ path: `${output}/letter-pending.png` });
  await tap(`button[data-id="${letterId}"][data-action="withdraw"]`);
  const withdrawn = await state();
  if (
    !Array.isArray(withdrawn.letters) ||
    !withdrawn.letters.some(
      (v: unknown) => isRecord(v) && v._id === letterId && v.reviewStatus === 'draft',
    )
  )
    throw Error('家书撤回失败');
  await tap(`button[data-id="${letterId}"][data-action="delete"]`);
  const deleted = await state();
  if (
    !Array.isArray(deleted.letters) ||
    deleted.letters.some((v: unknown) => isRecord(v) && v._id === letterId)
  )
    throw Error('家书删除后仍在列表');
  checks.push('家书撤回与软删除（原生确认框自动应答）');
  await app.restoreWxMethod('showModal');
  if (errors.length) throw Error(errors.join('\n'));
  await writeFile(
    `${output}/verification.json`,
    JSON.stringify(
      {
        status: 'passed',
        checks,
        errors,
        cloudVerified: false,
        deviceVerified: false,
        confirmationMocked: true,
        imagePickerMocked: true,
        testedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: 'passed', checks }));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await app.screenshot({ path: `${output}/failure.png` }).catch(() => undefined);
  await writeFile(
    `${output}/verification.json`,
    JSON.stringify({ status: 'failed', checks, errors, failure: message }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await app.restoreWxMethod('showModal').catch(() => undefined);
  await app.restoreWxMethod('chooseMedia').catch(() => undefined);
  for (const path of [imageFixturePath, savedImagePath].filter(Boolean))
    await app
      .evaluate(
        'function (path) { return new Promise(function(resolve) { wx.getFileSystemManager().removeSavedFile({filePath:path, success:resolve, fail:function(){try{wx.getFileSystemManager().unlinkSync(path);}catch(_){} resolve();}}); }); }',
        path,
      )
      .catch(() => undefined);
  // Restore the pre-test local database instead of leaving test publications behind.
  if (baseline) {
    await app.callWxMethod('setStorageSync', 'shixue-local-data-v1', baseline);
    if (editorBaseline) await app.callWxMethod('setStorageSync', editorKey, editorBaseline);
    else await app.callWxMethod('removeStorageSync', editorKey);
  }
  await app.reLaunch('/pages/launch/index').catch(() => undefined);
  app.disconnect();
}
