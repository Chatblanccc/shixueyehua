# 开发指引

2026-09-16 补充：开发版无 AppID / 云环境时，启动页可显式进入可保存数据的本地体验。已开发的身份/班级、收听/收藏/进度、管理员草稿/发布/下架均复用现有页面；“我的”可切换听众/管理员体验。见 [操作说明](local-experience.md)。模拟器入口 `devtools:verify`、`devtools:verify:stage2` 和 `devtools:verify:local` 现运行新的完整本地流程，以下阶段 1/2 计数保留为历史证据。旧脚本以 `devtools:verify:legacy` 留存，仅适用于旧版空态预览，不用于当前验收。真实云端失败不会转为本地成功。

更新：2026-09-15。原生工程与第一阶段基础代码已创建，本地质量检查和完整模拟器检查已通过；真实云端与手机尚未验收。当前测试号不能使用云服务，用户已选择先完成本地开发。

## 1. 从当前文件夹启动

微信开发者工具打开整个 `shixueyehua` 仓库根目录，不用再次新建模板。保留现有 AppID 和工具私有配置，项目已设置：

- `miniprogramRoot: miniprogram/`：小程序源码。
- `cloudfunctionRoot: dist/cloudfunctions/`：云函数构建产物。
- `setting.useCompilerPlugins: ["typescript"]`：微信原生 TS 编译。

建议先用版本管理器切换到 `.nvmrc` 的 Node 24.21.0；已有 Node 22 LTS 工具链也满足当前 engines，实际检查版本记录在[测试记录](test-cases.md)。

```bash
cd /path/to/shixueyehua # 替换为实际克隆目录
npm ci
npm --prefix miniprogram ci
npm run build
npm run devtools:build-npm
npm run devtools:open
```

根 `npm ci` 会生成默认开发配置及小程序共享模块；小程序依赖单独安装。CLI 默认位于 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，安装在其他位置时通过 `WECHAT_DEVTOOLS_CLI` 指定。工具需已登录并启用官方 CLI 服务；项目内脚本不会修改其安全开关。

如果手动打开工具：选择“导入”，选仓库根目录，再执行“工具 → 构建 npm”和编译。仅安装 npm 包不等于微信组件构建。[微信 npm 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/npm.html)

未配置云环境时，启动页明确显示预览说明；点击“进入页面预览”可切换夜话、一封家书、班级和我的。预览不设置 user、不保存业务数据，也不授予管理员权限。身份资料与三级选班已实现；当前无云时可体验内存中的资料草稿、查看选班空状态，提交不会生成假账号或假班级。播放、投稿仍未开放。

## 2. 每次改动运行的检查

```bash
npm run verify
npm run format:check
```

`verify` 依次执行 ESLint、客户端/服务端/测试严格类型检查、Vitest、本地配置生成、云函数构建和项目结构检查。微信编译插件不会替代 TypeScript 类型检查。[微信 TypeScript 文档](https://developers.weixin.qq.com/miniprogram/dev/devtools/compilets.html)

第二阶段已在 Node 24.21.0 下通过 `verify`、`format:check` 和 `check:cloud`：19 个测试文件共 235 项测试，其中后端 127 项、数据库 38 项、客户端 60 项、本地集成 3 项、SDK 兼容 7 项。当前结果见 [stage-2.md](stage-2.md)，第一阶段历史证据保留在 [test-cases.md](test-cases.md)。第二阶段模拟器于 2026-09-15 23:46:14（北京时间）通过全部 15 项检查，异常为 0；未连接真实云环境或手机。

其他实际命令：

| 命令                                      | 用途                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run prepare:local`                   | 生成 dev 配置与共享模块；内容相同不重写，不修改 AppID、不连云                             |
| `npm run build:shared`                    | 从 shared 单向生成客户端 JS 与类型入口；内容相同不重写                                    |
| `npm run build:cloud`                     | 构建六个独立函数包，校验运行 SDK 与锁文件一致                                             |
| `npm run check:project`                   | 检查14页、四Tab、分包、图标和依赖                                                         |
| `npm run check:cloud`                     | 校验六个实际部署包的锁文件与 vendor，在仓库外安装、审计运行依赖并加载六入口；不调用云接口 |
| `npm run devtools:verify`                 | 在微信模拟器验证本地预览与管理员拦截，保存截图和JSON记录                                  |
| `npm run db:init -- --dry-run`            | 查看集合、索引、初始规则及种子计划                                                        |
| `npm run db:bootstrap-admin -- --dry-run` | 查看首次授权计划，不授权账号                                                              |
| `npm run verify:stage1`                   | 串联本地质量、独立云包、两项 dry-run、根与小程序生产审计及模拟器验收                      |

`verify:stage1` 按清单顺序执行 `verify`、`format:check`、`check:cloud`、两项数据库 dry-run、根与小程序的 `npm audit --omit=dev`，最后执行 `devtools:verify`。本轮各子命令已分别实际通过；新增聚合命令后没有再整套重复运行。它覆盖本地验收，不执行云部署或真机检查。

2026-09-15 22:59:55（北京时间）的完整模拟器记录为 `passed`：启动页、四 Tab、全部七个管理页共 12 项检查通过，异常数为 0。管理页检查同时等待原生导航回调、核对实际页面栈，并点击返回页重新进入预览；`user` 始终为空。结果保存在被忽略的 `artifacts/devtools/verification.json` 和同目录截图，详见[测试记录](test-cases.md#4-微信模拟器检查)。

### 模拟器与路由检查注意事项

- 模拟器验证会切换页面，自动化启动也可能重新打开项目。先完成源码编辑和构建，再运行一次完整验证；验证期间不写入小程序源码或生成文件，避免热重载中断检查。
- `prepare:local` / `build:shared` 已改为内容相同不写文件，减少无改动生成引起的自动重编译。连续两次生成后 `env.ts`、`shared.js`、`shared.d.ts` 的纳秒修改时间均不变，记录见 `artifacts/acceptance/generated-file-stability.json`。仅改文档时检查文档格式、链接和 diff；没有新的代码变化、失败或未解决问题时，不重复重启工具或重跑已通过的模拟器验收。
- 会话重定向先等待 `onBeforeAppRoute` / `onAppRouteDone` 表示的原生路由完成，再串行发起下一次导航；不能用 `onReady` 或固定延时替代路由完成。基础库最低要求为 **3.5.5**，当前本地验证使用 **3.17.3**；取得正式 AppID 后还需在平台配置最低基础库版本，本地 `libVersion` 不代表该配置已完成。
- 本地 3.17.3 的 `reLaunch` 完成事件可能缺少事件 ID，已按路径、路由类型和原生页面 ID 的唯一候选配对；有歧义或超时不提前放行。修复与验证依据见 [DEC-010](decisions.md#dec-010-原生路由完成后再执行会话重定向)。
- 官方自动化 SDK 无法连接、导航或截图时应报告失败，用实际界面核验补充，不记录假通过。此次修复前的管理页重定向失败已由完整通过记录更新。

### GitHub Actions CI

[CI 工作流](../.github/workflows/ci.yml) 在每个 PR 和 `main` 分支推送时运行。单个 Ubuntu 24.04 作业从 `.nvmrc` 读取 Node 版本，分别安装根目录与小程序的锁定依赖，再执行 `verify`、`format:check`、`check:cloud`、两项数据库 dry-run，以及根和小程序生产依赖审计。`check:cloud` 同时检查实际云包的独立安装与运行依赖审计。

工作流只授予 `contents: read`，不持久化检出凭据；官方 [checkout](https://github.com/actions/checkout) 和 [setup-node](https://github.com/actions/setup-node) 固定为已核验的完整提交 SHA。每次作业最多运行 20 分钟，同一 PR 或分支的新运行会取消旧运行。无需配置云端密钥或 GitHub 仓库 Secrets。

CI 不启动 macOS 微信开发者工具，不调用真实云环境，不运行包含模拟器的 `verify:stage1` 聚合命令。微信 npm 构建、完整模拟器和真机仍按上面的本地流程分别验收。远端是否通过，以对应提交的 Actions 结果为准。

## 3. 目录与依赖边界

| 目录                        | 内容 / 维护规则                                                 |
| --------------------------- | --------------------------------------------------------------- |
| `miniprogram/pages`         | 用户页面和引导页，只调用service                                 |
| `miniprogram/package-admin` | 管理分包，进入时刷新身份和权限                                  |
| `miniprogram/components`    | 通用空态、页面Store绑定                                         |
| `miniprogram/services`      | 云调用、错误映射、超时、会话与导航                              |
| `miniprogram/stores`        | MobX 用户状态唯一来源；权限事实仍在云端                         |
| `miniprogram/generated`     | 自动生成环境与共享模块，不手改、不提交                          |
| `shared`                    | 领域类型、错误码、配置默认值和白名单解析，无Node/微信依赖       |
| `cloudfunctions`            | 六领域函数TS源码；共享鉴权、校验、日志、分页、SDK适配           |
| `config/cloud-runtime`      | 每个云包使用的生产依赖清单和传递依赖锁                          |
| `vendor/lodash-set-safe`    | 生产依赖兼容包源码；发布归档放入 `config/cloud-runtime/vendor/` |
| `scripts/database`          | 初始化、规则、索引、开发种子与首次授权                          |
| `tests`                     | backend / client / database本地测试，不依赖正式数据             |

根清单管理工具和云SDK，小程序清单管理TDesign与MobX，分别提交锁文件。客户端不能引用云SDK或运行时越过 `miniprogramRoot`；共享逻辑先打包到 `generated/shared.js`，类型入口只在编译期引用根共享类型。

## 4. 云环境配置：取得正式环境后再执行

当前工具查询云环境返回 `ret=-601059，测试号不能使用云服务`，不能用测试号完成可信微信登录、数据库与权限规则验收。无需为本地预览填假环境ID。

1. 使用具有云开发权限的真实小程序 AppID，并确认开发者权限和已关联的 dev 云环境。
2. 将 `config/environments.example.json` 复制为 `config/environments.local.json`，在对应作用域填实际环境ID。该文件被Git忽略。
3. 保持 dev/test/prod 环境互相隔离。`SHIXUE_ENV`默认dev；非dev没有明确envId时构建直接失败。
4. 可用 `SHIXUE_CLOUD_ENV_ID` 临时覆盖客户端构建环境；初始化脚本仍要求 `--env` 与本地dev配置精确匹配。
5. 项目AppID在 `project.config.json` 的 `appid` 中由工具管理，当前仍是测试号；AppID不是管理密钥。不得提交AppSecret、SecretId、SecretKey、访问令牌、真实OpenID或用户内容。

```bash
# 配置完成后生成指定环境的小程序配置；当前无需执行此项
SHIXUE_ENV=dev npm run build
```

没有明确环境ID时不会调用 `wx.cloud.init`，也不会回退到账号默认云环境。配置dev云环境后，页面预览模式自动关闭，恢复真实登录与onboarding守卫。

## 5. 云函数构建与部署边界

`npm run build:cloud` 用 esbuild 把共享源码包含在每个 `dist/cloudfunctions/<name>/index.js` 中，SDK 作为显式生产依赖。每个包必须同时携带 `package.json`、`package-lock.json`、`config.json` 和 `vendor/shixue-lodash-set-safe-1.0.1.tgz`，可在包目录执行 `npm ci --omit=dev`。vendor 归档是锁文件引用的本地依赖，只复制清单或入口文件会导致独立安装失败；不得上传未编译 TS 或只依赖根 node_modules 的目录。

本轮 `check:cloud` 已逐包核对六个实际 dist 包的运行清单、锁文件和 vendor 一致性，在仓库外按该锁安装并审计运行依赖，加载全部六个入口。该检查未调用真实云接口。

构建语法目标为Node 22兼容子集；计划云运行时优先Node 24 LTS，实际runtime标识仍须在目标控制台核验。当前未生成声称已部署的cloudbaserc配置，也未上传任何云函数。

部署 `authApi` 时配置服务端 `APP_ENV=dev`；`health`只在dev/test可调用，缺失、未知或prod时拒绝。它真实查询开发数据库后返回连通状态，不能用固定响应冒充健康检查。业务只信任SDK上下文OpenID与环境，每次管理操作重读role/adminSchoolId。

初始化与授权遵循[数据库指引](database.md)：先建立集合/规则/索引，真实账号调用login后，再从服务端确认OpenID并授权首位超管。脚本默认dry-run，当前不要运行apply。修改共享内核后重新构建并部署全部受影响函数。

根生产依赖、仓库外安装的云运行依赖及小程序依赖当前审计均为 0；含开发依赖的根审计仍有 17 个 moderate，high / critical 为 0。定向补丁、兼容回归与剩余处理项见[依赖审计](dependency-audit.md)。不以 `npm audit fix --force` 自动降级官方 SDK，真实部署前需再次审计并核验补丁的云端行为。

## 6. 第一阶段交付界限

| TASK      | 本地实现                                                  | 尚需真实证据                           |
| --------- | --------------------------------------------------------- | -------------------------------------- |
| 001 / 002 | 原生工程、组件、四Tab、分包、真实质量命令                 | 页面真机表现随后续业务验证             |
| 003       | 环境模板、生成脚本、dev预览与明确环境调用                 | 正式AppID关联、运行时、健康检查        |
| 100       | 领域类型、错误码、统一service与运行时解析                 | 后续接口持续复用                       |
| 101       | 服务端可信上下文、角色/学校鉴权、分页、审计与共享打包     | 云端入口和真实环境行为                 |
| 102       | 集合/索引清单、规则部署与回读代码、幂等种子、事务超管脚本 | 真实初始化、客户端拒绝、唯一索引、授权 |
| 103       | 原子登录、UserStore、超时与状态处理、稳定引导             | 真实微信身份和云端并发登录             |

阶段 0 前置与第一阶段的本地检查、模拟器检查已通过；第一阶段的真实云端和真机验收仍未完成。阶段 2 身份与选班、阶段 3 音频、阶段 4 家书仍按任务书推进。模拟测试不能证明云端规则或设备行为，开发者工具预览不能证明平台提审通过。

## 7. 常见问题

| 现象                 | 处理                                                 |
| -------------------- | ---------------------------------------------------- |
| 缺少generated模块    | 根目录运行 `npm run prepare:local`                   |
| TDesign/MobX找不到   | 安装小程序依赖后重新 `npm run devtools:build-npm`    |
| 无云环境/测试号错误  | 使用页面预览；有真实AppID和dev环境后再配置           |
| TS通过但组件显示异常 | 检查微信npm构建、基础库、组件路径和实际模拟器错误    |
| 云包找不到共享模块   | 重新build:cloud，只部署产物，按包内锁文件安装依赖    |
| 直接进入管理页被退回 | 未登录、未完成引导、被禁用或无授权；不要绕过守卫     |
| 初始化命令只显示计划 | 默认dry-run正常；有真实开发环境后再按数据库说明apply |

每个TASK更新[实施计划](implementation-plan.md)，列文件、命令、结果和剩余边界。实测记录集中在[test-cases.md](test-cases.md)，实际接口见[cloud-functions.md](cloud-functions.md)。

## 8. 第二阶段开发与验证

第二阶段分支为 `codex/stage-2-identity-classes`，包含 TASK-200～202。实现、接口与验证记录见 [stage-2.md](stage-2.md)。开发者工具的“我的 → 体验身份与资料填写”可以操作三种身份、昵称和内置头像；“预览班级选择”显示真实的未开通状态，返回或重新打开资料页保留本次草稿。

```bash
npm run verify
npm run format:check
npm run check:cloud
npm run devtools:verify:stage2
```

`verify:stage2` 串联与第一阶段相同的本地质量、云包检查、数据库 dry-run、生产审计，并使用第二阶段模拟器检查。`devtools:verify:stage2` 在无云预览模式运行原有启动 / Tab / 管理页检查，再验证资料输入、无云提交边界、选班空态和草稿恢复；会重新编译并切换页面，先结束源码编辑再运行。产物在被忽略的 `artifacts/devtools-stage2/`。

`tests/integration/stage2-flow.test.ts` 使用真实客户端解析器 / 控制器和真实云函数 handler，只替换微信传输与数据库，验证完整流程与事务失败恢复。它是本地集成证据，不能替代正式 AppID 下的登录、事务、安全规则或手机验收。阶段 1 的历史验收继续保留在 [test-cases.md](test-cases.md)。
