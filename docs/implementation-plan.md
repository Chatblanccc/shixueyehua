# 仓库审计与阶段实施计划

更新：2026-09-16。**阶段 3 用户侧音频、本地完整体验及管理员草稿/发布页面已实现并完成本地验证。** 真实云上传与手机验收仍待办。用户要求无 AppID / 云环境也能操作已开发功能，后续每个 TASK 必须同步维护本地体验路径，见 [本地体验说明](local-experience.md)。

## 1. 仓库与当前工程

| 项目                | 实际结果                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 本地项目            | `shixueyehua/` 仓库根目录                                                                                                           |
| 来源                | `https://github.com/Chatblanccc/shixueyehua.git`                                                                                    |
| 初次导入分支 / 提交 | `main`，`bfc49a87bebd5b974807c17b50031748639d40ee`                                                                                  |
| 第二阶段开发分支    | `codex/stage-2-identity-classes`；交付与 CI / 合并记录见 [PR #2](https://github.com/Chatblanccc/shixueyehua/pull/2)                 |
| 初次克隆            | 空目录导入文档仓库；原仓库没有页面、云函数、依赖或测试                                                                              |
| 文档准备            | 规则和 Markdown 基线归位；产品、路线图、技术栈、开发指引和导航补齐；2 份 Word 原件保留                                              |
| 当前源码            | `miniprogram/`、`shared/`、`cloudfunctions/`、`scripts/`、`tests/`                                                                  |
| 当前工具            | 验证使用 Node `24.21.0`；微信开发者工具 Stable `2.02.2608070`、基础库 `3.17.3`                                                      |
| 微信与云            | 开发者工具已登录；现有测试 AppID 查询云环境返回 `ret=-601059`“测试号不能使用云服务”                                                 |
| 远端交付            | 阶段 1 经 [PR #1](https://github.com/Chatblanccc/shixueyehua/pull/1) 合并至 main，提交 `20a5681`，GitHub Actions 通过；未部署云环境 |

初次审计时“没有源码、检查因 package.json 不存在未运行”是历史状态。当前命令见[开发指引](DEVELOPMENT.md)，阶段 1 历史结果见[测试记录](test-cases.md)，阶段 2 结果见第 5 节与[第二阶段说明](stage-2.md)，阶段 3 音频结果见第 6 节与[第三阶段说明](stage-3.md)。

## 2. 阶段 0 与阶段 1 执行结果

任务书阶段 1 仍指 `TASK-100～103`，阶段 0 是其工程前置。以下表格与第 3 / 4 节保留阶段 1 的历史验收和计数，不作为阶段 2 的新增结果；本地通过不等于真实云验收完成。

| TASK                    | 状态                   | 主要修改文件 / 目录                                                                         | 本地证据与剩余边界                                                                                                                   |
| ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| TASK-000 仓库审计       | 完成                   | README、AGENTS、docs                                                                        | 来源和历史原件保留，基线差异见 decisions                                                                                             |
| TASK-001 工程初始化     | 本地验收通过           | project.config.json、miniprogram/app.*、pages、package-admin、assets                        | 原生 TS、TDesign、四 Tab、14 页及分包；微信 npm 构建成功；模拟器启动 / Tab / 七管理页守卫检查通过                                    |
| TASK-002 质量工具       | 本地验收通过           | package 与锁文件、tsconfig.*、eslint / prettier / vitest 配置、vendor                       | lint、三套严格类型检查、13 文件 / 124 项测试、格式检查及构建通过；生产 / 实际部署包 / 小程序依赖审计为 0；剩余开发依赖见下文         |
| TASK-003 环境配置       | 本地验收通过；云端待验 | config、scripts/prepare-local.ts、miniprogram/config、云运行时                              | dev / test / prod 显式配置；只有未配置云的 dev 允许页面预览；真实环境健康检查待验                                                    |
| TASK-100 共享类型与接口 | 本地验收通过           | shared、miniprogram/services/cloud-client.ts                                                | 领域类型、错误码、白名单 DTO、统一调用、超时与异常响应测试通过                                                                       |
| TASK-101 云函数共享内核 | 本地验收通过；云端待验 | cloudfunctions/_shared、六函数入口、scripts/build-cloud.ts、scripts/check-cloud-packages.ts | 可信上下文、角色和学校范围、校验 / 审计 / 分页、SDK 回执验证；六个实际部署包含 vendor，在仓库外按锁文件安装、加载、审计通过          |
| TASK-102 数据初始化     | 本地验收通过；云端待验 | scripts/database、database/rules、tests/database                                            | 13 集合 / 24 索引清单、默认拒绝规则、幂等种子、事务首次授权、写入回执验证；数据库本地测试与两个 dry-run 通过，未执行 apply           |
| TASK-103 登录与会话     | 本地验收通过；云端待验 | authApi/login、客户端 auth / session / user.store、tests                                    | 原子建用户、并发与回执恢复、DTO、MobX、引导 / 权限守卫、超时和陈旧响应隔离；七管理页实际退回启动页且能恢复预览；真实微信身份联调待验 |

没有云配置时，启动页可进入四 Tab 预览；`user` 保持空，不能获得管理员权限。身份选班与权限守卫见第 5 节；音频的用户侧读取、播放、进度与收藏见第 6 节。家书、审核以及管理员发布与管理页面仍未实现；未实现动作必须返回明确的 `NOT_IMPLEMENTED`。

### 本轮修复与独立复核

- 云函数数据库适配器确认新增用户和审计回执，拒绝带 SDK 错误标记的查询结果，避免未确认写入或错误 health 假成功。
- 数据初始化与首次超管事务确认 `updated` / `upserted` 回执；所有非空删除标记均拒绝授权。
- 会话清空后允许立即重登，旧请求不会清理新请求；管理员导航使用真实回调与页面栈验证，重定向及预览恢复回归通过。
- 云包携带实际运行锁文件和 vendor，验证包内依赖的一致性与独立安装；生产依赖补丁另有 7 项专项兼容测试。

服务端 / 数据库复核、3 项修复及 96 项目标测试见[独立验收复核](acceptance-review.md)。客户端 21 项与依赖专项 7 项合计形成全仓 124 项测试，详见[测试记录](test-cases.md)。

## 3. 阶段 1 历史本地验收证据

| 检查                                 | 当前结果                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| 完整质量入口 `npm run verify`        | 通过：lint、三个 TypeScript 配置、13 文件 / 124 项测试、构建与项目结构检查                                 |
| `npm run format:check`               | 通过                                                                                                       |
| `npm run check:cloud`                | 六个最新实际部署包包含一致的清单 / 锁文件 / vendor；仓库外生产安装、逐一加载 `main` 与实际部署依赖审计通过 |
| 数据库与首位超管 dry-run             | 两命令退出码 0，`cloudContacted=false`，无真实数据变更                                                     |
| 根生产 / 实际部署包 / 小程序依赖审计 | 均为 0，退出码 0                                                                                           |
| 根全量依赖审计                       | 17 项 moderate、0 high、0 critical；退出码 1，不能称全部依赖审计通过                                       |
| 微信模拟器                           | 2026-09-15 **22:59:55（北京时间）**：12 项检查全部通过，异常 0                                             |

模拟器 12 项包括启动页、四个 Tab 和七个管理页；管理页检查等待导航回调完成并确认实际页面栈返回启动页，没有创建用户，随后再次点击预览可恢复使用。对应生成报告为 `artifacts/devtools/verification.json`，报告仍明确 `cloudVerified=false`、`deviceVerified=false`。旧的管理员重定向失败已修复，不再作为当前失败项。

已建立统一命令：

```bash
npm run verify:stage1
```

它串联完整质量检查、格式检查、实际云包检查、两个数据库 dry-run、根及小程序生产依赖审计和模拟器检查。**各子命令已实际验证**；本记录不把新串联命令的存在当成额外一次执行证据。运行条件见[开发指引](DEVELOPMENT.md)。该命令不会部署云函数或执行数据库 `--apply`。

## 4. 第一阶段验收清单

| 编号  | 检查           | 本地证据                                                                          | 尚需真实验收                                        |
| ----- | -------------- | --------------------------------------------------------------------------------- | --------------------------------------------------- |
| S1-01 | 工程与质量命令 | 微信 npm 构建；lint / typecheck / 124 tests / build / format；12 项模拟器检查通过 | 手机设备布局与兼容性随后续业务验收                  |
| S1-02 | 云环境与独立包 | 六包从最新产物按运行锁安装 SDK / vendor，在仓库外加载并审计通过                   | 实际部署、平台运行时和 health requestId             |
| S1-03 | 登录唯一性     | 原子创建、重复 / 并发、冲突与不确定响应恢复、回执校验                             | 真实账号并发登录只产生一条用户记录                  |
| S1-04 | 身份可信       | SDK 身份边界、伪造输入与 DTO 白名单测试                                           | 真实微信 SDK 上下文不可伪造验收                     |
| S1-05 | 角色与范围     | 跨校、切校、禁用、删除与撤权测试；七管理页拒绝导航                                | 云端每次请求重查授权和真实账号状态                  |
| S1-06 | 会话与页面     | loading、重试、超时、稳定引导、迟到响应隔离及预览恢复                             | 真实登录至身份 / 班级页面                           |
| S1-07 | 初始化幂等     | 数据库脚本测试、事务回执与两个 dry-run                                            | 开发环境重复执行、唯一索引生效、首次授权事务        |
| S1-08 | 客户端直连防护 | 默认拒绝规则、部署和回读实现、非法返回拒绝                                        | 数据库与存储真实直接访问均被拒绝                    |
| S1-09 | 可维护性与依赖 | 锁文件、显式配置、构建和接口文档；生产与实际部署依赖审计为 0                      | 部署前再次审计并复核剩余开发依赖；验证真实 SDK 兼容 |

## 5. 阶段 2 本地验收与真实验收待办

| TASK           | 已实现内容与主要文件                                                                                                                                                                | 当前状态                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 200 身份资料   | `pages/onboarding/`、`services/profile-controller.ts`、`authApi/profile.ts`：三种身份、昵称、内置 avatarPreset、账号隔离草稿、字段白名单和事务审计；自定义头像上传未做              | 本地验收通过；真实云与真机待验 |
| 201 班级选择   | `pages/class-select/`、`services/class*.ts`、`classApi/classes.ts`、`_shared/db.ts`：CursorPage 目录、三级联动、层级校验、成员事务、当前班级 null 失效语义及 scopeRevision 缓存隔离 | 本地验收通过；真实云与真机待验 |
| 202 管理员守卫 | `services/admin-guard.ts`、`services/session-controller.ts`、`package-admin/`：onLoad / onShow 强制刷新、旧请求隔离、操作拒绝后退出、超管页面限制                                   | 本地验收通过；真实云与真机待验 |

2026-09-15 **23:43:33（北京时间）**，Node `24.21.0` 下最后重跑的 `verify`、`format:check` 退出 0：19 个测试文件 / **235 项测试**，以及 lint、三套严格类型检查、构建和格式检查通过。本地日志为 `artifacts/acceptance/stage2-quality.log`。`check:cloud` 首次因 npm TLS 中断，单独重试退出 0，六个实际云包仓库外安装 / 加载 / 审计通过，重试日志为 `artifacts/acceptance/stage2-cloud-retry.log`。两个数据库 dry-run 与根 / 小程序生产依赖审计也分别退出 0，未执行云端变更。

同日 **23:46:14（北京时间）**，阶段 2 模拟器 15 项检查全部通过，异常为 0；报告 `artifacts/devtools-stage2/verification.json` 为 `status=passed`，仍明确 `cloudVerified=false`、`deviceVerified=false`。检查包含原有 12 项启动 / Tab / 管理守卫导航，以及资料表单、无云预览边界、返回并重开后的草稿恢复。上述生成日志与报告均不提交，不覆盖阶段 1 历史证据。

当前本地验收入口为 `npm run verify:stage2`；各子命令已分别实际运行通过，未记录整条串联命令一次退出 0。本阶段开发分支为 `codex/stage-2-identity-classes`，交付见 [PR #2](https://github.com/Chatblanccc/shixueyehua/pull/2)，CI 与合并状态以 PR 记录为准。

完整 API、成员历史规则、头像范围与验证明细见[第二阶段说明](stage-2.md)。夜话已在阶段 3 实现用户侧真实接口与页面；家书仍在阶段 4 开发。当前没有真实云调用或真机结果。

## 6. 阶段 3 音频用户侧本地验收与真实验收待办

| TASK                 | 已实现内容与主要文件                                                                                                                                                         | 当前状态                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 300 音频查询         | `audioApi`、`_shared/audio-*`、`shared/audio.ts`：按可信当前学校/班级过滤 published 内容、范围绑定游标、详情二次可见性校验、短期媒体 URL、历史/收藏关系合并                      | 本地验收通过；真实云与存储待验   |
| 301 首页与详情       | `pages/night-talk/`、`pages/audio-detail/`、`audio-*-controller.ts`：本期卡、分页/刷新、骨架、空态、错误重试、长标题/缺图降级和详情页                                        | 本地验收通过；真实云与真机待验   |
| 302 全局播放器       | `stores/player.store.ts`、`player-*.ts`、`components/mini-player/`：单例后台播放器、锁屏元数据、切集/前后 15 秒/seek、过期 URL 与网络失败重试，夜话、家书、我的与详情挂载迷你播放器 | 本地验收通过；真机后台/锁屏待验  |
| 303 进度、历史与收藏 | `audioApi.saveProgress/history/listFavorites/toggleFavorite`、`player-progress.ts`、历史/收藏页：5 秒服务端限流、15 秒客户端合并保存、95% 完成、离线本机恢复和幂等收藏       | 本地验收通过；真实事务与索引待验 |

2026-09-16，Node `24.21.0` 下最终执行 `npm run verify`、`npm run format:check` 和 `npm run check:cloud` 均退出 0：24 个测试文件 / **310 项测试**通过，ESLint、三套严格 TypeScript、构建、格式和六个独立云函数包仓库外加载/生产依赖审计均通过。测试替身严格实现当前 BackgroundAudioManager 回调签名；这避免测试代码掩盖小程序 API 类型不匹配。

这些均为本地证据：没有正式 AppID 或 CloudBase 环境，未上传云文件、未签发真实临时 URL、未验证数据库索引/事务，也未在 iOS、Android 或锁屏后台场景运行。

### TASK-304 / 305 与无云体验补充

| TASK                   | 本轮修改文件及行为                                                                                                                                                                                            | 验收与剩余边界                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 304 音频上传与草稿     | `miniprogram/services/admin-audio.service.ts`、`package-admin/pages/audio-create/`、`package-admin/admin-page.ts`：文件选择、大小限制、封面压缩、PUT 传输阶段与取消、服务端确认、草稿新建/编辑/试听、离开提醒 | 本地表单保存通过；真实微信文件选择、云 PUT 和存储权限仍待验证；仅有上传阶段反馈，不伪造网络百分比                       |
| 305 音频管理           | `package-admin/pages/audio-manage/`、`pages/home/index.wxml`：三种状态筛选、分页、编辑、试听、发布/下架/软删除二次确认；下架通知全局播放器                                                                    | 模拟器发布后首页可见、下架后不可见通过；原生确认框自动应答，真实云事务/审计待验证                                       |
| 体验基础（用户新要求） | `services/local-*.ts`、`services/local.service.ts`、`cloud-api.ts`、`audio.service.ts`、`player.service.ts`、`user.store.ts`、启动/我的/夜话/详情页面、`assets/demo-night.m4a`                                | dev 无云且显式启用；独立数据存储，示例组织/节目、角色切换、收藏/进度、资料/选班、重置；test/prod 或已配置云拒绝本地分支 |

本轮代码检查：26 文件 / **325 项测试**通过，`npm run verify` 覆盖 lint、三套严格类型检查、构建及项目结构；新增 `tests/client/local-experience.test.ts` 与 `tests/client/admin-upload.test.ts` 覆盖本地业务、持久化、角色/班级边界、幂等建档、存储错误、模式隔离，以及真实传输失败/取消/确认时序。修复进度四舍五入超过小数总时长的问题。

微信模拟器报告 `artifacts/local-experience/verification.json`：6 项通过，异常 0；实际示例音频播放且时间推进，收藏保存，真实输入保存草稿，发布后首页显示，下架后移除。`confirmationMocked=true`，`cloudVerified=false`，`deviceVerified=false`。脚本结束恢复运行前本地数据库。细节见 [本地体验说明](local-experience.md)。

## 7. 后续顺序与剩余边界

### 2026-09-16 家书前置推进：TASK-600（部分完成）

- 已实现文本分段检查、图片异步受理、超时与失败默认阻止、严格结果解析、作者反馈脱敏、仅无云开发可用的演示反馈；正式家书接口尚未开放。
- 主要文件：`cloudfunctions/_shared/content-safety.ts`、`wechat-content-safety.ts`、`runtime.ts`、`handler.ts`；`shared/content-safety.ts`、`errors.ts`、`index.ts`；`miniprogram/services/local-content-safety.ts`；`scripts/cloud-permissions.ts`、`build-cloud.ts`、`check-cloud-packages.ts`；两份 content-safety 测试。详见 [内容安全说明](content-safety.md)。
- 待完成：图片实际归属解析器、可信微信异步回调及版本绑定、TASK-400/401 业务和本地页面接入；真实平台验收仍延期。故障不会回退成本地成功。本轮没有新增投稿页面或声称图片已审核通过。
- 阶段 3 已经 PR #3 合并 main（`0fa6534`），本轮从干净 main 创建 `codex/stage-4-content-safety` 开发。
- 验证：2026-09-16 12:19（北京时间），`npm run verify` 通过 lint、三套 typecheck、28 文件 / **369 项测试**及构建；新增 44 项测试。`npm run format:check`、`git diff --check` 通过。12:18 的 `npm run check:cloud` 已验证本轮构建/权限清单及六包独立加载和生产依赖审计，此后只新增测试与文档。未运行微信模拟器、真实云或真机；本轮没有页面改动。

| 阶段               | TASK                         | 当前状态 / 依赖                                                    |
| ------------------ | ---------------------------- | ------------------------------------------------------------------ |
| 云端补验           | 003、101、102、103           | 等待可用真实 AppID 和 dev 环境；按数据库、规则、登录与授权顺序补验 |
| 2 身份与选班       | 200、201、202                | 本地验收通过；真实云与真机待验，详见 stage-2.md                    |
| 3 夜话音频         | 300、301、302、303           | 用户侧本地验收通过；真实云、存储与真机待验，详见 stage-3.md        |
| 3 夜话音频         | 304、305                     | 页面与本地业务体验已实现；真实文件选择、上传、云存储/事务待验      |
| 4 一封家书         | 400、401、402、403、404、405 | 图文投稿与分层本地页面已接通；真实云、完整筛选、公开与审核等仍待完成 |
| 5 管理中心         | 500、501、502、503、504      | 尚未实现；只有分包占位与权限入口守卫                               |
| 6 内容安全前置     | 600                         | 上传归属、投稿协调与回调接线本地通过；真实平台审核与回调待验 |
| 6 安全、体验与发布 | 601、602、603、604           | 尚未验收；初始数据库 / 存储拒绝规则代码已随 102 交付               |

```mermaid
flowchart LR
  Local[阶段1本地验收通过] --> Cloud[003/101/102/103 云端补验]
  Local --> Identity[200/201/202 已本地实现]
  Identity --> Stage2QA[阶段2本地验收通过]
  Cloud --> Cloud2[阶段2真实身份与事务补验]
  Stage2QA --> Audio[300系列 夜话音频]
  Cloud --> Safety[600 内容安全]
  Safety --> Letters[400系列 家书投稿]
```

- 用户暂无云配置，本轮不创建云资源、不部署、不初始化真实数据库、不授权真实账号。
- [依赖审计](dependency-audit.md)已记录生产补丁及兼容验证；全量开发依赖剩余 17 项 moderate，不能表述为所有安全风险已清除。进入真实部署前须重新审计并复核剩余项。
- 真实微信身份、云端规则 / 唯一索引 / 事务、手机、平台审核与发布均未验收。模拟器和本地替身不能替代这些证据。
- 初次初始化就部署默认拒绝规则；上传开发时按 TASK-601 逐项开放最小权限。TASK-600 内容安全必须先于 TASK-400 真实投稿。
- 首位超管须先经真实微信登录生成用户，再通过服务端可信记录受控授权；用户自选 `currentSchoolId` 不影响 `adminSchoolId`。
- P1 保留在 V0.1 范围；公开家书上线前必须完成举报处置。

真实云就绪后按[开发指引](DEVELOPMENT.md)、[数据库指引](database.md)、[安全规则](security-rules.md)、[云函数接口](cloud-functions.md)和[独立复核待验清单](acceptance-review.md)补验。每个 TASK 继续记录修改文件、检查结果、环境与未验证边界；不记录密钥或真实用户内容。

### TASK-600 第二次推进：加密回调与事务绑定

- 新增 `cloudfunctions/_shared/safety-callback.ts`、`safety-jobs.ts`、`safety-jobs-db.ts`、`safety-http.ts`；修改 `letterApi/index.ts`、`runtime.ts` 与 `scripts/database/manifest.ts`，新增默认拒绝的 `media_safety_jobs` 集合和索引清单。
- 实现签名验证、AES 解密与 AppID 绑定；任务原子登记与匹配草稿版本的结果保存；重复幂等、冲突拒绝、迟到失效；回调不能发布家书，凭据缺失时关闭入口。
- 新增 `tests/backend/safety-callback.test.ts`、`tests/database/safety-jobs-db.test.ts` 并更新集合数量测试。2026-09-16 12:37（北京时间）`npm run verify` 通过 lint、三个 typecheck、**30 文件 / 413 项测试**与构建；`format:check`、`check:cloud` 通过，六包独立加载及生产依赖审计通过。未触达真实云或手机，未新增页面，因此不重复模拟器验收。
- TASK-600 仍部分完成：缺图片真实上传归属解析器、提交端任务登记/恢复接入、真实平台回调验收。下一项 TASK-400 开始家书草稿与文本提交闭环，TASK-401/601 同步补图片上传。未经归属与检查确认的图片不会被开放。
- 完整协议、环境变量、HTTP 映射假设、文件清单及限制见 [内容安全记录](content-safety.md)。本轮未推送、创建 PR、合并或部署。
- `npm run db:init -- --dry-run` 退出 0：16 个集合清单包含新增任务集合及三个索引，`cloudContacted=false`；`git diff --check` 通过。

### TASK-600 交付与 TASK-400 文字家书推进

- TASK-600 当前安全基础由提交 `c4b9b19` 推送，随后 [PR #4](https://github.com/Chatblanccc/shixueyehua/pull/4) 经 CI 后 squash 合并至 main `e857ab73faaabcd541519b3dfdab20556614c82b`。[PR CI](https://github.com/Chatblanccc/shixueyehua/actions/runs/35056800844) 与 [main CI](https://github.com/Chatblanccc/shixueyehua/actions/runs/35056867935) 均成功。合并的是已验证安全基础，不取消图片归属及真实平台的剩余验收项。
- 新分支 `codex/task-400-letters`：实现文字家书 createDraft/updateDraft/submit/withdraw/delete，以及仅本人 detail/listMine。共享 DTO 白名单、服务端作者校验、可信组织绑定、草稿幂等、版本冲突、文本检查后事务复验和软删除均有测试。失败不清除草稿、不自动公开、不回退本地成功。
- 同步提供原生家书 Tab 的文字编辑、保存/提交、本人列表和状态操作；本地模式持久化，未保存编辑按账号/模式隔离；重置体验明确清除家书。界面标注本地待审不是微信检查结果。基础页面支持 TASK-400 验收，不将 TASK-401/403 全部标记完成。
- 修改文件清单、输入输出、状态机与限制见 [文字家书记录](letters.md)。新测试为 `tests/backend/letters.test.ts`、`tests/client/local-letters.test.ts`、`tests/database/letters-db.test.ts`；更新 fixtures、本地兼容测试和微信模拟器脚本。数据库清单增加 `letters.author_live_cursor` 索引。
- 2026-09-16 12:59（北京时间），Node `22.23.2` 下 `npm run verify` 通过 lint、三套严格类型检查、**33 文件 / 439 项测试**和构建；格式检查通过。微信开发者工具首次新流程验收 9 项通过，异常 0，覆盖实际音频播放和文字家书输入、保存、待审、撤回、软删除。原生确认框自动应答，测试后恢复数据库及编辑缓存；随后截图复核修正标题输入框裁切并复验。
- TASK-400 仍部分完成：非空图片列表失败关闭，图片数量配置/上传归属/异步检查接入待 TASK-401/601；审核、精选公开、举报另属后续 TASK。未调用真实 CloudBase、微信文本/图片安全或手机，未声称上线验收通过。本分支尚未推送或合并。
- 最终复验：13:02:54 完整 `npm run verify` 通过 **33 文件 / 440 项测试**（补充提交时采用用户最新可信班级的用例），lint、三套 typecheck、构建均通过。13:02:59 模拟器 9 项再次通过，异常 0，截图确认标题不再裁切；报告 `artifacts/local-experience/verification.json` 明确 `confirmationMocked=true`、`cloudVerified=false`、`deviceVerified=false`。`format:check`、`check:cloud`、数据库初始化 dry-run（包含新增索引，未连接云）及 `git diff --check` 通过。

### TASK-400 / 600 图片提交前置：异步检查协调

- 新增 `cloudfunctions/_shared/safety-submission.ts`、`safety-submission-db.ts`：服务端确定性任务键、并发租约、任务/回执原子登记、读取已验证回调、版本复验与超时恢复。不会修改或发布家书；相同版本的拒绝结果不通过重复请求绕开。
- 修改 `safety-jobs-db.ts` 复用严格草稿解析；`scripts/database/manifest.ts` 新增默认拒绝集合 `media_safety_submissions` 与过期索引；更新 `tests/database/database.test.ts` 至 17 个集合。新增 `tests/backend/safety-submission.test.ts` 的 24 项回归。
- 2026-09-16 13:26（北京时间），Node 22 下 `npm run verify` 通过 lint、三套严格类型检查、**34 文件 / 464 项测试**与构建。测试首次发现参数化数组用例的 TypeScript 写法错误，修正后完整重跑通过。
- 当前交付仅为图片安全协调模块，尚未接入运行时 submit。图片真实上传/归属解析、配置上限、提交事务最终复验、服务与页面接线和无云图片体验仍待实现；用户图片入口继续关闭，文字家书不受影响。不能据此将 TASK-400 或 TASK-600 标记完成。
- 没有页面或本地业务改动，不重跑微信模拟器、不把上一轮 9 项结果当作图片验收；没有真实云部署/平台调用/真机检查。后续完成图片链路时须同步提供明确标记的本地体验。详细协议与文件见 [内容安全记录](content-safety.md)。
- 补充检查：`npm run format:check`、`npm run check:cloud`、`npm run db:init -- --dry-run`、`git diff --check` 均退出 0。六个既有云函数包独立加载及部署依赖审计通过；新增协调模块尚未被业务运行时引用，云包检查不代表该模块已接线。dry-run 列出 17 个集合，`cloudContacted=false`。本轮在 `codex/task-400-letters` 本地提交，不推送或部署。

### TASK-400 / 401 / 601 图文接线与页面分层

- 服务端新增 `letterApi/images.ts`：作者草稿绑定的图片准备/确认/取消、私有预览与过期清理；实际字节/MIME/大小校验、隔离上传和不可覆盖最终文件。票据内嵌受保护 letters 记录，作者 DTO 不返回内部票据。修改 `_shared/audio-storage.ts` 扩展受控 letter 路径，图片通道拒绝音频/WebP/SVG 和跨路径域封存；保持默认拒绝存储规则。
- 新增 `_shared/letter-config.ts`，通过 `db.ts`、`letter-repository.ts` 接入默认→全局→学校覆盖的图片开关和数量；配置错误失败关闭。`letter-db.ts` 严格还原图片票据及聚合安全摘要。`handler.ts`、`runtime.ts`、`letterApi/letters.ts` 接通可信图片解析与异步协调器，最终事务复验作者、组织、版本、图片与配置，pending/unavailable 不入队。
- 前端依照用户“不堆叠、有层次和艺术美”的要求拆为 `pages/letters/` 阅读入口、`pages/my-letters/` 本人列表、`pages/write-letter/` 信纸编辑器；`letters/controller.ts` 复用状态行为。纸张留白、墨色标题、暖金细节，正文/附件/范围分区，底部固定操作与错误反馈；明确 20 字提交门槛。`app.json` 当前 19 页。
- 新增 `services/letter-image.service.ts`，实际选择、压缩、文件保存/限时 PUT、校验、预览与取消；`local-letters.ts`、`local-repository.ts` 独立保存本地图片引用与恢复。无云时图片确实保存本机，不伪造平台审核；未改稿件重试提交不递增 revision，避免异步检查不断失效。
- 新测试：`tests/backend/letter-images.test.ts`、`tests/database/letter-config.test.ts`，补充 local-letters、storage 与 fixtures。覆盖作者/草稿归属、未确认/取消/重复图片、异步 pending、封存失败、配置禁用、清理保留引用、跨域路径、重开恢复。
- Node `22.23.2`，2026-09-16 15:03 完整 `npm run verify` 通过 lint、三套 typecheck、**36 文件 / 480 项测试**与构建；`format:check`、`check:cloud`、`git diff --check` 通过。六个已包含新运行时接线的函数包独立加载及部署依赖审计通过，未调用真实云。
- 15:04:45 模拟器 **10 项通过，异常 0**，包含实际压缩/本机保存、重开恢复图片、提交及撤回/删除；选择器使用包内图片夹具，原生确认框自动应答，`imagePickerMocked=true`、`confirmationMocked=true`、`cloudVerified=false`、`deviceVerified=false`。首次发现开发者工具保存文件返回 `http://store/`，原路径校验未兼容；修正后完整复验通过。验收前备份现有数据库与编辑缓存，结束恢复，不覆盖用户现有家书。
- 尚待：真实 AppID/云上传/回调/事务/真机相册验收；按用户的上传速率限制、无人返回时的定时孤儿文件清理、本机保存文件的回收、客户端同步学校较低图片上限；TASK-403 完整筛选与详情、TASK-404 审核/精选等。暂不宣称 TASK-400/401/601 的上线验收全部完成。本轮无云部署、推送、PR 或合并。
- 收尾复验：15:08 完整 verify、格式和云包检查通过；补充切换另一封家书前的未保存编辑确认提示后，再次通过 lint、三套 typecheck、480 项测试、格式检查及模拟器 10 项检查（异常 0）。切换草稿确认的取消分支尚未单独自动化验收。文档相对链接 103 项有效，`git diff --check` 通过；代码保留在当前本地开发分支。

### TASK-400 图文家书合并前复核

- 2026-09-16 按用户要求复核整个分支（文字投稿、图片安全协调、图文接线与页面分层）。发现独立列表删除家书后，编辑器缓存仍可能恢复已删除稿件；在 `services/letter-editor-cache.ts` 增加按稿件匹配清理，并接入 `pages/letters/controller.ts` 的成功删除路径。不会清除其他稿件、账号或模式的缓存。
- `tests/client/local-letters.test.ts` 增加缓存隔离回归；`scripts/verify-local-experience.ts` 在列表删除前植入匹配编辑缓存并检查成功删除后清空。`npm run verify` 通过 **36 文件 / 481 项测试**、lint、三套 typecheck、构建；模拟器 **10 项通过，异常 0**，包含新增删除缓存回归。选图器为图片夹具、确认框自动应答；数据库与原编辑缓存已恢复。
- `format:check`、`check:cloud`、数据库初始化 dry-run 和根/小程序生产依赖审计通过（均 0 vulnerabilities）；未执行真实云操作。无其他已发现的开发阶段合并阻断项；上节真实平台验证、限流与文件回收等上线前待办不因本次合并而关闭。
- 用户进一步要求后续按页面性质寻找网络样式参考，分别设计按钮和内容呈现，避免统一矩形堆叠；已补充到 `docs/decisions.md`，本轮不扩大重设计范围。
