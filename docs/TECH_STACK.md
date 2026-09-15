# 技术栈与架构基线

> 更新：2026-09-15。原生工程、第一阶段基础及第二阶段身份 / 班级 / 守卫代码已实现，本地质量检查与 15 项模拟器检查通过，异常为 0。当前测试号不能使用云服务，用户已明确先做本地开发；云函数部署、数据库规则生效及真实微信联调仍待正式 AppID 和开发环境。需求和任务以 [PRD](PRD.md)、[CODEX_TASKS](CODEX_TASKS.md) 为准；基线修订见 [技术与产品决策](decisions.md)。

## 1. 技术选型

| 层次       | 选型                                               | 责任与边界                                                                    |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| 小程序     | 微信原生小程序、WXML、WXSS                         | 四个 Tab 和管理员分包；使用微信原生页面生命周期与能力                         |
| 类型系统   | TypeScript，`strict: true`                         | 客户端、云函数和脚本分别配置类型环境；外部值先作为 `unknown` 校验             |
| UI         | TDesign Miniprogram                                | 按需引入组件，统一主题、表单和反馈状态                                        |
| 全局状态   | `mobx-miniprogram`、`mobx-miniprogram-bindings`    | UserStore 已实现；PlayerStore 与播放器留待 TASK-302，不另设第二套全局状态来源 |
| 客户端访问 | `wx.cloud` + `services/`                           | 页面调用服务，统一封装云函数请求、错误和登录失效                              |
| 服务端     | CloudBase 普通云函数，TypeScript 构建为 JavaScript | 六个领域函数按 `action` 路由，不新增独立 HTTP 服务                            |
| 云函数 SDK | `wx-server-sdk@4.0.2`                              | 接收微信可信调用上下文；精确运行清单和锁文件随每个函数包分发                  |
| 本地云管理 | `@cloudbase/manager-node`、`@cloudbase/node-sdk`   | 集合、规则、种子及首次授权脚本；开发依赖，不进入客户端或云函数运行清单        |
| 数据与文件 | CloudBase 文档数据库、云存储、安全规则             | 学校范围隔离、唯一索引、软删除、文件归属与临时文件清理                        |
| 内容安全   | 微信官方内容安全能力 + 人工审核                    | 经共享适配层接入；检查失败不得直接公开                                        |
| 工程质量   | ESLint、Prettier、TypeScript、Vitest               | Node 24.21.0 下 19 个测试文件共 235 项测试及统一质量检查通过；模拟器另记      |
| 包管理     | npm + 提交的锁文件                                 | 区分根目录开发工具、小程序依赖和云函数生产依赖                                |

不引入 Taro、uni-app、FastAPI、PostgreSQL、Redis、Docker、独立服务器或 Web 管理后台。用户音频上传、评论、私信、关注、排名、支付和广告不在本项目范围内。

TDesign 和 MobX 已安装在 `miniprogram/` 的独立依赖清单中；组件路径例如 `tdesign-miniprogram/button/button`。依赖安装、微信 npm 构建、模拟器验证分别记录，不能只凭 npm 安装完成就声称组件显示通过。[TDesign 官方仓库](https://github.com/Tencent/tdesign-miniprogram)、[MobX 小程序绑定官方仓库](https://github.com/wechat-miniprogram/mobx-miniprogram-bindings)

## 2. 版本与运行环境

### 2.1 本地 Node 与云端运行时分别锁定

2026-09-15 核验时，Node.js 官方将 Node 24、22 列为 LTS，将 Node 20 列为 EOL。历史任务书的“Node.js 20 LTS”不能继续作为新工程的默认建议。[Node.js 发布状态](https://nodejs.org/en/about/previous-releases)

CloudBase 官方运行环境表列出普通云函数支持 Node 24.11、22.21、20.19 等版本，并将 24.11 标为推荐 LTS。这个平台支持清单不等于本项目目标环境已经支持且部署成功。[CloudBase 运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)

| 对象                 | 当前选择                                                                                | 当前证据                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 本地开发工具链       | `.nvmrc` 锁定 Node `24.21.0`；根 engines 兼容 `^22.13.0 \|\| ^24.0.0`                   | Node 24.21.0 已跑完整本地验证；原系统 Node 22.23.2 不作为当前默认基线          |
| CloudBase 普通云函数 | TASK-003 核验目标环境可选版本，优先 24 LTS；若不可选，则验证仍受支持的 22 LTS并记录差异 | 尚未检查控制台，未确定最终 `runtime` 配置值，未部署                            |
| 构建与测试           | esbuild 云函数语法目标为 `node22`；构建 CommonJS 独立包，SDK 与兼容归档作为显式依赖     | 六个实际部署包经锁文件及 vendor 核对，在仓库外安装、加载与生产审计通过；未部署 |
| 小程序基础库         | 路由事件契约最低要求 `3.5.5`；本地验证使用 `3.17.3`                                     | 完整模拟器 12 项检查通过；正式平台最低版本尚待配置，真机与后台播放未验收       |

不得因为本地 Node 较新，就在云函数中直接使用目标运行时不支持的 API；本项目不以 Node 20 新部署。首次部署时六个函数必须选用同一经过目标环境验证的运行时；Node 22 兼容的构建目标不等于云端已经选定 Node 22。

### 2.2 已锁定版本

以下与根 / 小程序的清单及锁文件一致；版本调整须同步锁文件与验证记录。

| 用途                  | 精确版本                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------- |
| TypeScript / 类型解析 | `typescript@5.9.3`、`typescript-eslint@8.70.0`；TypeScript 选择兼容当前 ESLint 解析器的版本 |
| 静态检查与格式        | `eslint@10.10.0`、`prettier@3.9.6`                                                          |
| 测试与构建            | `vitest@5.0.1`、`tsx@4.23.13`、`esbuild@0.28.2`                                             |
| 微信类型与自动化      | `miniprogram-api-typings@5.2.3`、`miniprogram-automator@0.12.1`                             |
| 小程序组件与状态      | `tdesign-miniprogram@1.16.1`、`mobx-miniprogram@6.12.3`、`mobx-miniprogram-bindings@7.0.0`  |
| 云函数生产 SDK        | `wx-server-sdk@4.0.2`；运行锁文件位于 `config/cloud-runtime/`                               |
| 本地数据库与规则管理  | `@cloudbase/manager-node@5.8.7`、`@cloudbase/node-sdk@3.18.3`                               |

根生产依赖、仓库外安装的云运行依赖及小程序依赖审计均为 0；含开发依赖的根审计仍有 17 个 moderate，high / critical 为 0。生产链通过定向补丁和实际 SDK 兼容回归修复，不能把剩余开发告警或真实云端验证标记为完成；详见[依赖审计与部署前处理项](dependency-audit.md)。

### 2.3 编译不代替类型检查

小程序已配置开发者工具内置 TypeScript 编译插件 `setting.useCompilerPlugins: ["typescript"]`。该插件转换类型语法，不负责完整的类型错误检查，所以 `npm run typecheck` 单独检查客户端、服务端 / 脚本和测试。云函数独立构建为 JavaScript 产物。[微信原生 TypeScript 支持](https://developers.weixin.qq.com/miniprogram/dev/devtools/compilets.html)

小程序 npm 包在安装之后，还需要执行开发者工具的“工具 → 构建 npm”，或仓库的 `npm run devtools:build-npm`。本项目已使用根目录工具链清单与 `miniprogram/package.json` 分离的布局，使小程序依赖位于 `miniprogramRoot` 内；安装与运行步骤见[开发指引](DEVELOPMENT.md)。[微信 npm 支持](https://developers.weixin.qq.com/miniprogram/dev/devtools/npm.html)

## 3. 调用与构建边界

```text
页面 / 组件
  → services/*.service.ts
  → services/cloud-client.ts
  → wx.cloud.callFunction
  → 领域云函数入口
  → 共享鉴权 / 校验 / 错误 / 审计
  → 业务逻辑
  → CloudBase 数据库 / 存储 / 内容安全
```

- 页面只处理交互、展示和生命周期；不直接调用数据库或散落调用云函数。
- `UserStore` 是客户端用户状态的唯一来源，云端用户记录才是权限事实来源。后续 `PlayerStore` 按同样约定集中管理播放状态和音频实例。
- 共用领域类型、错误码和无平台依赖的校验逻辑；客户端不得引用云函数 SDK、凭据读取或服务端审计实现。
- 云函数 `_shared` 是一份源码。构建时将所需模块打包进每个函数部署目录，不让部署产物依赖目录外的 `../_shared`，不手工维护六份副本。
- 每个云函数部署包同时携带精确运行清单、锁文件及 `vendor/shixue-lodash-set-safe-1.0.1.tgz`；兼容包源码保留在根 `vendor/lodash-set-safe/`。独立安装必须带齐锁文件引用的归档，不能只复制入口或 package.json。
- 文件临时 URL 是按需派生结果，业务记录保存 `fileId`；公开响应按字段白名单输出。

`prepare:local` 将 `shared/` 单向打包到 `miniprogram/generated/`，避免客户端运行代码越过源码根。环境配置及共享产物内容相同时不重写文件，减少微信工具无改动自动重编译。无开发云环境时明确生成 `previewMode=true`，只展示本地页面；不伪造账号、不自动调用云接口、不在请求失败后返回假成功。test/prod 构建缺环境 ID 会失败。

会话导航由 `RouteTransition` 等待原生路由完成，再交由 `SessionNavigator` 串行调用微信导航 API。全局监听 `onBeforeAppRoute` 与 `onAppRouteDone`，不使用固定延时推定动画完成；本地 `reLaunch` 空完成 ID 的处理及最低基础库约束见 [DEC-010](decisions.md#dec-010-原生路由完成后再执行会话重定向)。这项页面守卫不替代云端鉴权。

## 4. 领域云函数与集合

函数名、`action` 和响应结构沿用 [任务书第 6 节](CODEX_TASKS.md#6-云函数接口清单)。六个函数入口、共享内核和构建已存在；实际支持的 action 与限制见[接口文档](cloud-functions.md)，未实现的业务 action 返回明确错误。

| 函数            | 责任                                 | 当前实现范围                                                                                           |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `authApi`       | 登录、档案、注销申请                 | `login`、`getProfile`、`updateProfile` 与 dev/test `health` 已实现；`requestDelete` 待开发，真实云待验 |
| `classApi`      | 学校、年级、班级、选班               | 三级目录分页、`selectClass` 事务及 `getCurrentClass` 已实现；真实云待验                                |
| `audioApi`      | 可见音频、播放进度、收藏             | 业务在阶段 3                                                                                           |
| `letterApi`     | 草稿、投稿、精选、撤回、举报         | 业务在阶段 4                                                                                           |
| `adminAudioApi` | 音频草稿、发布、下架、软删除         | 业务在阶段 3，所有 action 检查管理员授权                                                               |
| `adminApi`      | 审核、学校班级管理、授权、配置、日志 | 按阶段 4、5 实现                                                                                       |

共享请求为 `{ action, payload?, requestId? }`，统一结果为 `ApiResult<T>`。失败分支有稳定的 `error.code`、面向用户的文案及 `requestId`；未知 action、非法字段和无可信身份都必须返回明确错误。重试只应用于可安全重试的读操作或具有幂等保证的写操作。

集合保持为：

| 领域       | 集合                                                         |
| ---------- | ------------------------------------------------------------ |
| 身份与组织 | `users`、`schools`、`grades`、`classes`、`class_memberships` |
| 夜话音频   | `audio_programs`、`play_progress`、`favorites`               |
| 家书       | `letters`、`reports`                                         |
| 管理与配置 | `admin_logs`、`system_configs`、`notifications`              |

TASK-102 的 manifest 和初始化代码已定义 `users.openid`、`play_progress(userId, audioId)`、`favorites(userId, audioId)` 唯一索引及其余查询索引；脚本支持离线 dry-run，真实集合创建和索引生效尚未执行。说明见[数据库初始化](database.md)。只在服务端设置创建、修改、发布、审核和删除时间，业务记录采用软删除。

## 5. 身份与授权

| 信息                 | 来源                                                         | 用途                                                     |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| OpenID               | 云函数通过 `wx-server-sdk.getWXContext()` 获得可信调用上下文 | 定位用户；不采用 `payload.openid`                        |
| `identity`           | 用户可选 `student` / `parent` / `teacher`                    | 学校关系标签，不能授予权限                               |
| `role`               | 服务端用户记录                                               | `user` / `admin` / `super_admin`，不得由个人资料接口改写 |
| `currentSchoolId` 等 | 服务端校验学校、年级、班级层级后保存                         | 当前收听与家书内容范围，可由选班流程变更                 |
| `adminSchoolId`      | 初始化或超级管理员授权时由服务端设置                         | 普通管理员的独立授权学校；选班不能改变该字段             |

微信官方提供云函数上下文中的可信用户标识；实际角色、账号状态和资源学校范围仍由本项目在每次请求中验证。[获取小程序用户信息](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/functions/userinfo.html)

普通管理员的 `role === 'admin'` 与 `adminSchoolId` 必须同时满足授权要求。修改当前学校、选择教师身份或伪造请求学校都不能获得其他学校的管理权限。`super_admin` 的跨校能力也要检查可信角色、账号状态与目标资源，不能省略审计。撤权后下一请求必须重新读取并拒绝旧权限。

所有特权写入通过云函数；数据库与存储规则默认拒绝，按需要开放。不能只验证业务建档而放开正式音频目录写入。TASK-102 开始真实数据库联调前应有基础拒绝规则；后续文件上传和家书公开联调前分别完成 TASK-601、TASK-600 对应安全能力，不能等到发布前才补。

## 6. 第一阶段技术交付

第一阶段严格指 **阶段 1：TASK-100～TASK-103**，前置为阶段 0 的工程与环境初始化。

| TASK     | 当前本地成果                                                       | 仍需验证                                               |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| TASK-100 | 领域类型、错误码、请求封装、service；本地严格检查与边界测试通过    | 与后续实际业务接口持续联调                             |
| TASK-101 | 共享鉴权、学校范围、校验、分页、审计、六函数构建；本地检查通过     | 真实环境部署、身份上下文与持久化审计                   |
| TASK-102 | 13 集合与索引 manifest、默认拒绝规则、幂等种子、首位超管脚本及测试 | 真实初始化、唯一索引、客户端拒绝访问、登录后的首次授权 |
| TASK-103 | `authApi.login`、用户唯一性处理、UserStore、启动分流；可控测试通过 | 真实微信登录、并发建档、清缓存恢复与真机流程           |

阶段 1 历史记录：Node 24.21.0 下共 124 项测试通过（后端与数据库 96、客户端 21、SDK 兼容 7），质量检查、格式检查、独立云包检查、两项 dry-run 及生产审计分别通过。2026-09-15 22:59:55（北京时间）的模拟器记录为 `passed`：启动、四 Tab、七个管理页共 12 项检查，异常数 0；管理页核对原生回调、实际页面栈及重新进入预览的操作，未创建假用户。

`npm run verify:stage1` 已提供上述命令的聚合入口，阶段 1 子命令分别实跑通过，新增入口后未为重复验收而重启整套模拟器。第一阶段尚不包含完整选班、音频播放和家书审核闭环；真实云端与真机尚未验收。各类证据见[测试记录](test-cases.md)，操作与避免无谓重启的说明见[开发指引](DEVELOPMENT.md)。

第二阶段当前质量记录：2026-09-15 23:43:33（北京时间），Node 24.21.0 下 19 文件 / 235 项测试通过（后端 127、数据库 38、客户端 60、本地集成 3、SDK 兼容 7），`verify` 与 `format:check` 通过；`check:cloud` 在 npm TLS 中断后单独重试通过。23:46:14 的本阶段模拟器 15 项检查通过、异常 0；真实云端与真机未验收。接口、事务与缓存边界见[第二阶段说明](stage-2.md)。

## 7. 官方资料核验记录

以下来源于 **2026-09-15** 核验。当前本地版本以已提交清单和锁文件为准；首次真实部署时仍需核验目标平台运行时和权限。

| 官方来源                                                                                                       | 本文使用的结论                                    |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [Node.js 发布状态](https://nodejs.org/en/about/previous-releases)                                              | 区分仍受支持的 LTS 与 EOL                         |
| [CloudBase 运行环境支持](https://docs.cloudbase.net/cloud-function/runtime-support)                            | 普通云函数运行时支持与推荐版本                    |
| [微信 TypeScript 编译](https://developers.weixin.qq.com/miniprogram/dev/devtools/compilets.html)               | 内置编译插件与独立类型检查边界                    |
| [微信 npm 支持](https://developers.weixin.qq.com/miniprogram/dev/devtools/npm.html)                            | 安装、构建 npm、依赖目录映射                      |
| [微信项目配置](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html)                   | `miniprogramRoot`、`cloudfunctionRoot` 与编译配置 |
| [TDesign Miniprogram 官方仓库](https://github.com/Tencent/tdesign-miniprogram)                                 | npm 安装与组件注册方式                            |
| [MobX 小程序绑定官方仓库](https://github.com/wechat-miniprogram/mobx-miniprogram-bindings)                     | Store 绑定与 npm 构建要求                         |
| [微信云函数用户上下文](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/functions/userinfo.html) | 通过 `getWXContext()` 获取可信用户身份            |
