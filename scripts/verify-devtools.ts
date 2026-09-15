import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import automator from 'miniprogram-automator';
import { isRecord } from '../shared';

type MiniProgram = Awaited<ReturnType<typeof automator.launch>>;
const output = resolve('artifacts/devtools');
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
      'function () { var pages = getCurrentPages(); var page = pages[pages.length - 1]; return page ? { path: page.route } : null; }',
    );
    if (isRecord(snapshot) && typeof snapshot.path === 'string') lastRoute = snapshot.path;
    if (lastRoute === expected) {
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
