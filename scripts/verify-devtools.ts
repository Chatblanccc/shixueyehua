import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import automator from 'miniprogram-automator';
import type { InputElement } from 'miniprogram-automator/out/Element';
import { isRecord } from '../shared';

type MiniProgram = Awaited<ReturnType<typeof automator.launch>>;
const stage2 = process.argv.includes('--stage2');
const output = resolve(stage2 ? 'artifacts/devtools-stage2' : 'artifacts/devtools');
const checks: string[] = [];
const errors: string[] = [];
let mini: MiniProgram | undefined;
let currentStep = '启动开发者工具';

async function step<T>(label: string, task: () => Promise<T>, timeoutMs = 25000): Promise<T> {
  currentStep = label;
  console.log(label);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}超时，请保持模拟器连接且暂停热更新。`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function verifyRoute(app: MiniProgram, expected: string) {
  let lastRoute = '';
  for (let attempt = 0; attempt < 30; attempt++) {
    // Automator 0.12.1 caches Page.path by pageId. reLaunch can reuse that id,
    // so read WeChat's live stack instead of trusting the cached SDK path.
    const snapshot: unknown = await app.evaluate(
      'function () { var pages = getCurrentPages(); var page = pages[pages.length - 1]; return page ? { path: page.route, pendingRoutes: getApp().__verificationRoutes.length } : null; }',
    );
    if (isRecord(snapshot) && typeof snapshot.path === 'string') lastRoute = snapshot.path;
    if (lastRoute === expected && isRecord(snapshot) && snapshot.pendingRoutes === 0) {
      const page = await app.currentPage();
      if (!page) throw new Error('微信页面不存在');
      await page.waitFor(250);
      return page;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`页面未进入 ${expected}，实际为 ${lastRoute}`);
}

await mkdir(output, { recursive: true });
try {
  const app = await step(
    '启动开发者工具',
    () =>
      automator.launch({
        cliPath:
          process.env.WECHAT_DEVTOOLS_CLI ??
          '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
        projectPath: process.cwd(),
        timeout: 45000,
      }),
    50000,
  );
  mini = app;
  app.on('exception', (error: unknown) => errors.push(String(error)));
  // A page enters getCurrentPages before its native animation completes. An immediate
  // second tap can race that transition even when the destination route already matches.
  await app.evaluate(`function () {
    var app = getApp();
    app.__verificationRoutes = [];
    app.__verificationRouteEvents = [];
    wx.onBeforeAppRoute(function (event) {
      app.__verificationRouteEvents.push({ kind: 'before', path: event.path, type: event.openType });
      if (!event.notFound) app.__verificationRoutes.push(event);
    });
    wx.onAppRouteDone(function (event) {
      app.__verificationRouteEvents.push({ kind: 'done', path: event.path, type: event.openType });
      var matches = app.__verificationRoutes.filter(function (pending) {
        return event.routeEventId
          ? pending.routeEventId === event.routeEventId
          : pending.path === event.path && pending.openType === event.openType && pending.webviewId === event.webviewId;
      });
      if (matches.length === 1) app.__verificationRoutes.splice(app.__verificationRoutes.indexOf(matches[0]), 1);
    });
  }`);
  await step('检查启动页与页面预览按钮', async () => {
    await app.reLaunch('/pages/launch/index');
    const launch = await verifyRoute(app, 'pages/launch/index');
    await launch.waitFor('#preview-entry');
    const state: unknown = await launch.data();
    if (!isRecord(state) || state.previewMode !== true || state.user !== null)
      throw new Error('此检查只适用于无云配置的dev预览，必须保持未登录。');
    const button = await launch.$('#preview-entry');
    if (!button) throw new Error('缺少预览按钮');
    await app.screenshot({ path: `${output}/launch.png` });
    await button.tap();
    await verifyRoute(app, 'pages/night-talk/index');
    checks.push('启动页提示页面预览；点击进入夜话，不创建假用户');
  });
  for (const tab of ['night-talk', 'letters', 'class', 'profile']) {
    await step(`检查 ${tab} Tab`, async () => {
      await app.switchTab(`/pages/${tab}/index`);
      const page = await verifyRoute(app, `pages/${tab}/index`);
      const data: unknown = await page.data();
      if (!isRecord(data) || data.user !== null || data.previewMode !== true)
        throw new Error(`Tab ${tab}出现虚构用户或丢失预览标记`);
      if (tab === 'profile' && data.isAdmin !== false)
        throw new Error('未登录页面不应拥有管理员权限');
      await app.screenshot({ path: `${output}/${tab}.png` });
      checks.push(`${tab} Tab 可切换，页面保持未登录预览`);
    });
  }
  for (const name of [
    'home',
    'audio-create',
    'audio-manage',
    'letter-review',
    'class-manage',
    'admin-manage',
    'settings',
  ]) {
    await step(`检查管理页 ${name} 的跳转回调与拦截`, async () => {
      await app.switchTab('/pages/profile/index');
      await verifyRoute(app, 'pages/profile/index');
      // Await the real native callback as well as the final stack: neither may hang.
      await app.navigateTo(`/package-admin/pages/${name}/index`);
      const launch = await verifyRoute(app, 'pages/launch/index');
      await launch.waitFor('#preview-entry');
      const data: unknown = await launch.data();
      if (!isRecord(data) || data.user !== null) throw new Error('管理员守卫后不应创建用户');
      await app.screenshot({ path: `${output}/admin-guard-${name}.png` });
      checks.push(`管理页 ${name}：导航回调完成，实际退回启动页且未创建用户`);
      const button = await launch.$('#preview-entry');
      if (!button) throw new Error('拦截后未恢复预览入口');
      await button.tap();
      await verifyRoute(app, 'pages/night-talk/index');
    });
  }
  if (stage2) {
    async function tap(selector: string): Promise<void> {
      const page = await app.currentPage();
      if (!page) throw new Error('页面不存在');
      await app.pageScrollTo(0);
      await page.waitFor(selector);
      const element = await page.$(selector);
      if (!element) throw new Error(`缺少 ${selector}`);
      const offset: unknown = await element.offset();
      if (isRecord(offset) && typeof offset.top === 'number') {
        await app.pageScrollTo(Math.max(0, offset.top - 100));
        await page.waitFor(150);
      }
      await element.tap();
      await page.waitFor(150);
    }
    await step('检查身份、昵称和内置头像表单', async () => {
      await app.switchTab('/pages/profile/index');
      await verifyRoute(app, 'pages/profile/index');
      await tap('#profile-preview-entry');
      const identity = await verifyRoute(app, 'pages/onboarding/identity');
      await identity.waitFor('#identity-parent');
      await tap('#identity-parent');
      const input = await identity.$('#nickname-input');
      if (!input || input.tagName !== 'input') throw new Error('缺少真实昵称输入框');
      await (input as InputElement).input('本地验收听友');
      await tap('#avatar-bamboo');
      const state: unknown = await identity.data();
      if (
        !isRecord(state) ||
        state.identity !== 'parent' ||
        state.nickname !== '本地验收听友' ||
        state.avatarPreset !== 'bamboo' ||
        state.previewMode !== true
      )
        throw new Error('身份草稿与真实输入不一致');
      await app.pageScrollTo(0);
      await app.screenshot({ path: `${output}/identity.png` });
      checks.push('真实身份卡、昵称输入和内置头像选择更新预览草稿');
    });
    await step('检查预览保存边界与选班空状态', async () => {
      await tap('#identity-submit');
      const identity = await verifyRoute(app, 'pages/onboarding/identity');
      const state: unknown = await identity.data();
      if (
        !isRecord(state) ||
        typeof state.errorMessage !== 'string' ||
        !state.errorMessage.includes('云服务')
      )
        throw new Error('预览提交必须提示云服务未启用');
      await app.screenshot({ path: `${output}/profile-preview-draft.png` });
      await tap('#preview-class-select');
      const selection = await verifyRoute(app, 'pages/class-select/index');
      const selected: unknown = await selection.data();
      if (
        !isRecord(selected) ||
        selected.previewMode !== true ||
        selected.selectedSchool !== null ||
        selected.selectedGrade !== null ||
        selected.selectedClass !== null ||
        !isRecord(selected.schools) ||
        !Array.isArray(selected.schools.items) ||
        selected.schools.items.length !== 0
      )
        throw new Error('无云环境不得生成虚构学校或选班成功');
      await app.screenshot({ path: `${output}/class-selection.png` });
      checks.push('预览保存无假成功；三级选班为空且不能提交');
    });
    await step('检查返回及重新打开表单保留草稿', async () => {
      await tap('#edit-profile');
      let identity = await verifyRoute(app, 'pages/onboarding/identity');
      const previous: unknown = await identity.data();
      if (
        !isRecord(previous) ||
        previous.nickname !== '本地验收听友' ||
        previous.identity !== 'parent'
      )
        throw new Error('返回资料后草稿丢失');
      await app.navigateBack();
      const profile = await verifyRoute(app, 'pages/profile/index');
      const account: unknown = await profile.data();
      if (!isRecord(account) || account.user !== null || account.isAdmin !== false)
        throw new Error('页面预览产生了账号或权限');
      await tap('#profile-preview-entry');
      identity = await verifyRoute(app, 'pages/onboarding/identity');
      const reopened: unknown = await identity.data();
      if (
        !isRecord(reopened) ||
        reopened.nickname !== '本地验收听友' ||
        reopened.avatarPreset !== 'bamboo'
      )
        throw new Error('重新打开资料后草稿丢失');
      await app.pageScrollTo(0);
      await app.screenshot({ path: `${output}/draft-restored.png` });
      checks.push('返回上一步和销毁后重开仍保留本次草稿；始终无用户与管理权限');
    });
  }
  await step('返回夜话页面', () => app.switchTab('/pages/night-talk/index'));
  if (errors.length) throw new Error(`模拟器出现未捕获异常：${errors.join('\n')}`);
  await writeFile(
    `${output}/verification.json`,
    JSON.stringify(
      {
        status: 'passed',
        checkedAt: new Date().toISOString(),
        mode: 'local-dev-preview-no-cloud',
        checks,
        exceptions: errors,
        cloudVerified: false,
        deviceVerified: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ status: 'passed', checks, artifacts: output }, null, 2));
} catch (error: unknown) {
  const routeState = await mini
    ?.evaluate(
      `function () {
      return {
        paths: getCurrentPages().map(function (page) { return page.route; }),
        events: (getApp().__verificationRouteEvents || []).slice(-30)
      };
    }`,
    )
    .catch(() => null);
  await writeFile(
    `${output}/verification.json`,
    JSON.stringify(
      {
        status: 'failed',
        checkedAt: new Date().toISOString(),
        currentStep,
        checks,
        exceptions: errors,
        cloudVerified: false,
        deviceVerified: false,
        routeState,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + '\n',
  );
  throw error;
} finally {
  mini?.disconnect();
}
