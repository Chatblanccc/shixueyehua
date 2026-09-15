import { existsSync, readFileSync } from 'node:fs';
import { isRecord } from '../shared';

const app: unknown = JSON.parse(readFileSync('miniprogram/app.json', 'utf8'));
const project: unknown = JSON.parse(readFileSync('project.config.json', 'utf8'));
if (!isRecord(app) || !isRecord(project)) throw new Error('项目配置格式错误。');
if (
  project.miniprogramRoot !== 'miniprogram/' ||
  project.cloudfunctionRoot !== 'dist/cloudfunctions/'
)
  throw new Error('源码与部署目录不匹配。');
if (!Array.isArray(app.pages) || !app.pages.every((p): p is string => typeof p === 'string'))
  throw new Error('缺少页面。');
const routes = [...app.pages];
const subpackages: unknown = app.subPackages ?? app.subpackages;
if (!Array.isArray(subpackages) || subpackages.length === 0) throw new Error('缺少管理员分包。');
for (const pkg of subpackages) {
  if (!isRecord(pkg) || typeof pkg.root !== 'string' || !Array.isArray(pkg.pages))
    throw new Error('分包配置错误。');
  for (const p of pkg.pages) {
    if (typeof p !== 'string') throw new Error('分包路由错误。');
    routes.push(`${pkg.root}/${p}`);
  }
}
for (const route of routes) {
  for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
    if (!existsSync(`miniprogram/${route}.${extension}`))
      throw new Error(`缺少 ${route}.${extension}`);
  }
}
if (!isRecord(app.tabBar) || !Array.isArray(app.tabBar.list) || app.tabBar.list.length !== 4)
  throw new Error('必须有四个 Tab。');
for (const item of app.tabBar.list) {
  if (!isRecord(item) || !routes.includes(String(item.pagePath))) throw new Error('Tab 路由无效。');
  for (const key of ['iconPath', 'selectedIconPath']) {
    if (typeof item[key] !== 'string' || !existsSync(`miniprogram/${item[key]}`))
      throw new Error(`Tab 图标缺失：${key}`);
  }
}
for (const pkg of ['tdesign-miniprogram', 'mobx-miniprogram', 'mobx-miniprogram-bindings']) {
  if (!existsSync(`miniprogram/node_modules/${pkg}/package.json`))
    throw new Error(`请先安装小程序依赖 ${pkg}`);
}
console.log(`项目结构检查通过：${routes.length} 个页面、4 个 Tab、管理员分包、依赖与图标完整。`);
