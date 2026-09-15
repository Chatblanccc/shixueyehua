# 第二阶段：身份、班级与管理员守卫

更新：2026-09-15。**TASK-200 / 201 / 202 本地开发与验收通过，真实云与真机待验。** 第一阶段已通过 [PR #1](https://github.com/Chatblanccc/shixueyehua/pull/1) 合并至 `main`，提交 `20a5681`，GitHub Actions 已通过。第一阶段的历史测试与模拟器计数保留在[实施计划](implementation-plan.md)和[测试记录](test-cases.md)，不作为本阶段的新增验证结果。

用户暂无正式 AppID / CloudBase 环境，继续本地开发。本阶段没有部署云函数、写入真实班级数据或授予真实管理员；真实微信登录、云事务和手机验收仍待办。

## 1. TASK 与实现范围

| TASK               | 当前实现                                                                                    | 主要文件                                                                               | 当前验收状态           |
| ------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------- |
| 200 身份与资料     | 学生 / 家长 / 教师卡片、昵称、内置头像样式；内存草稿、编辑资料、白名单更新与审计            | `pages/onboarding/`、`services/profile-controller.ts`、`authApi/profile.ts`、`shared/` | 本地验收通过；云端待验 |
| 201 三级班级与切换 | 学校 → 年级 → 班级联动、分页与重试、确认加入 / 切换；服务端层级校验、成员事务与当前班级摘要 | `pages/class-select/`、`services/class*.ts`、`classApi/classes.ts`、`_shared/db.ts`    | 本地验收通过；云端待验 |
| 202 管理员守卫     | 七个管理页 onLoad / onShow 强制校验；操作前刷新、撤权退出、超管页面限制、迟到响应隔离       | `services/admin-guard.ts`、`services/session-controller.ts`、`package-admin/`          | 本地验收通过；云端待验 |

页面目录位于 `miniprogram/`，服务端目录位于 `cloudfunctions/`。音频、家书与管理业务的占位动作仍返回 `NOT_IMPLEMENTED`，本阶段没有新增可用的上传、发布、审核或授权接口。

## 2. TASK-200：身份与资料

- 必须选择 `student` / `parent` / `teacher`；教师身份不会授予管理角色。
- `nickname` 可省略；提供时必须是字符串，服务端限制原始长度最多 80 个字符、拒绝控制字符并去除首尾空白，空白昵称采用“夜话听友”。
- `avatarPreset` 为可选枚举：`moon`（月光）、`book`（书页）、`bamboo`（青竹）。这是页面内置样式选择，**自定义头像选图、上传和 `avatarFileId` 写入没有实现**。
- 草稿只在当前小程序进程内存中保留，并按账号区分；返回页面可继续编辑，成功保存后清理该账号草稿。预览草稿不创建用户，不写云端。
- 后端 `updateProfile` 只接收 `identity`、`nickname`、`avatarPreset`；OpenID、role、status、adminSchoolId、schoolId 以及 currentSchoolId 等额外字段均拒绝。
- 写入前读取可信登录用户；事务内重新读取并确认同一账号仍 active、未删除，再更新允许字段和 `profile_update` 审计。提交身份变化时，同一事务同步当前有效班级中已存在的 active 成员身份；不会凭资料编辑创建缺失成员，也不会改写其他历史班级成员的身份。

## 3. TASK-201：班级目录与成员关系

### API 契约

统一返回 `ApiResult<T>`：成功为 `{ success: true, data, requestId }`，失败为 `{ success: false, error, requestId }`。下表描述 `payload` 和成功 `data`；客户端仅通过 service 调云函数。

| 云函数 / action            | payload                                     | 成功 data                                              |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| `authApi.updateProfile`    | `{ identity, nickname?, avatarPreset? }`    | `LoginResult`：`{ user: UserProfile, onboardingStep }` |
| `authApi.getProfile`       | 无需业务参数                                | 同上；只读，不在不存在账号时创建用户                   |
| `classApi.listSchools`     | `{ pageSize?, cursor? }`                    | `CursorPage<SchoolOption>`                             |
| `classApi.listGrades`      | `{ schoolId, pageSize?, cursor? }`          | `CursorPage<GradeOption>`                              |
| `classApi.listClasses`     | `{ schoolId, gradeId, pageSize?, cursor? }` | `CursorPage<ClassOption>`                              |
| `classApi.selectClass`     | `{ schoolId, gradeId, classId }`            | `LoginResult`，包含服务端确认的当前学校 / 年级 / 班级  |
| `classApi.getCurrentClass` | `{}` 或省略 payload                         | `{ school, grade, class }` 或 `null`                   |

`SchoolOption` 只包含 `_id`、`name`；`GradeOption` 增加 `schoolId`；`ClassOption` 再增加 `gradeId`、`joinMode: 'free'`。列表只展示 active、未软删除的组织，班级还必须允许自由加入。停用学校、无效年级或跨层级参数返回明确错误；不返回伪造的空成功结果。

### 游标与失败处理

`CursorPage<T>` 固定为 `{ items: T[], nextCursor?: string }`，不是裸数组。服务端默认每页 20，允许 1～100，按 `_id` 升序获取多一条判断后续页。游标绑定列表类型及学校 / 年级范围；换学校后不能沿用原范围游标。

客户端追加分页时按 ID 去重，失败保留已有选项，重试不重置上级选择；更换学校清空年级 / 班级，更换年级清空班级。旧请求的响应不能覆盖新选择或已卸载页面。

### 事务、幂等与历史

`selectClass` 从可信账号读取用户，在同一事务内重新检查账号状态及学校—年级—班级关系。随后按 `(userId, classId)` 派生稳定成员 ID，写入或恢复该班级的成员记录，更新用户三个当前组织 ID，并写 `class_switch` 日志。已确认的同班选择不会重复写用户或产生切班日志；确需修复当前成员状态 / 身份时仍会更新成员记录。

切班保留过去班级的成员记录及原始创建时间；“当前班级”以用户的 currentSchoolId / currentGradeId / currentClassId 为准，不把历史成员误当成当前选择。所有这些操作都不修改 `adminSchoolId`、角色或账号状态。

微信 SDK 运行入口显式设置 `throwOnNotFound: false`，使事务查找尚不存在的成员文档可返回 `null` 并进入新增路径。数据库适配器检查读写返回形状、更新数量、插入 ID 和事务提交回执。真实云端的唯一索引、并发冲突及提交行为仍需联调验证。

### 当前班级与缓存

`getCurrentClass` 不接受客户端指定用户或班级；仅查询当前可信用户的选择。如果尚未选班，或学校 / 年级 / 班级已失效、层级不一致、不能自由加入，返回 `null`。客户端对“用户已有 currentClassId 却收到 null”显示当前班级不可用及重新选择入口。

会话成功更新后，账号或当前三个组织 ID 改变会递增 `scopeRevision`，清空当前班级摘要和错误，令旧范围请求失效。班级页、我的页，以及夜话 / 家书页通过 Store 绑定接收范围变化；后续查询从新选择开始。四个 Tab 每次 onShow 强制刷新当前班级摘要，以发现之后发生的组织停用；序列号和范围版本仍隔离迟到响应。

**夜话与家书的真实内容列表分别属于阶段 3 / 4，尚未实现。** 当前只建立范围失效通知和班级摘要刷新基础，不能称已完成真实音频 / 家书列表的切班刷新。

## 4. TASK-202：管理员页面与操作

- `requireAdminPage` 在七个管理页的 onLoad 和每次 onShow 执行；先设 `allowed=false`、清除页面 user 与权限提示，再等待服务端刷新。管理页不直接绑定可能迟到回填的旧用户快照。
- 会话强制刷新不复用进入后台前的 in-flight 请求；会话和页面各有版本校验，旧响应不能放行或发起迟到重定向。页面 onHide 清空内容，onUnload 后不再回写。
- `admin` 必须 active 且有 adminSchoolId；`super_admin` 可进入管理区。管理员管理页额外要求 super_admin。预览且无用户时直接回启动页，不尝试云登录。
- `wrapAdminAction` 在实际动作前重新检查授权。收到 `FORBIDDEN`、`SCHOOL_SCOPE_DENIED`、`USER_DISABLED`、`USER_DELETED` 或 `UNAUTHORIZED` 时，先锁页，再清理 / 刷新会话并退出管理页；即使刷新后仍是 admin，也退出当前被拒绝的页面。网络及普通业务错误只显示安全错误文案，不因此清会话。
- 当前“重新核验权限”动作调用已有 `authApi.getProfile`。业务接口的最后防线仍在云函数：每个管理请求重新检查角色、授权学校，授权 / 撤权动作要求超管；不以页面守卫代替服务端鉴权。

## 5. 本地验证与待验边界

2026-09-15 **23:43:33（北京时间）**，Node `24.21.0` 下完成最终代码的 `verify` 和 `format:check`，日志为 `artifacts/acceptance/stage2-quality.log`。随后 `check:cloud` 遇到 npm 审计服务 TLS 连接中断，单独重试后退出 0，记录在 `artifacts/acceptance/stage2-cloud-retry.log`。上述生成日志不提交。

| 项目                                          | 本阶段当前记录                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| TASK 专项及客户端—真实 handler 本地集成       | 19 个测试文件 / 235 项测试通过：后端 127、数据库 38、客户端 60、本地集成 3、依赖兼容 7 |
| ESLint / 三套 TypeScript / 格式检查           | 通过；verify 和 format:check 退出 0                                                    |
| 本地构建 / 六个实际云函数包 / 依赖审计        | 通过；check:cloud 退出 0，实际云包仓库外安装、加载及生产审计通过                       |
| 微信模拟器身份、选班、导航与权限检查          | 23:46:14 全部 15 项通过，异常 0；真实输入与按钮操作，未注入假账号                      |
| 数据库 / 首位超管初始化 dry-run、生产依赖审计 | 两项预演通过且未连接云端；根与小程序生产依赖审计均为 0                                 |
| 真实微信账号、云函数、数据库事务与安全规则    | 未验证；等待正式 AppID 和 dev 环境                                                     |
| iOS / Android 真机及平台发布                  | 未验证                                                                                 |

用例覆盖资料字段拒绝与草稿、三级联动 / 分页 / 无效组织、成员幂等与事务回滚、旧响应与缓存失效、管理员撤权与生命周期。本地集成使用实际云函数 handler 和客户端控制器，持久层及可信上下文仍为本地测试替身，不代表真实云联调。模拟器记录为 `artifacts/devtools-stage2/verification.json`；检查包含启动、四 Tab、七管理页访问拦截，以及身份 / 昵称 / 头像输入、选班空状态、返回与重新打开草稿。初次检查发现自动操作早于原生路由动画完成，脚本现等待导航完成和页面元素可用；截图复核还修正了基础库默认 184px 按钮宽度对身份卡及表单按钮的覆盖。最终截图 `identity.png`、`class-selection.png`、`draft-restored.png` 位于同一目录。

`npm run verify:stage2` 聚合上述检查；本轮各子命令分别实跑通过。当前成果保存在本地分支 `codex/stage-2-identity-classes`，本阶段尚未推送、创建 PR 或执行 GitHub CI。阶段 1 的 PR / CI 通过不能代替本阶段的远程结果。

完整需求仍以 [PRD](PRD.md) 和 [TASK-200～202](CODEX_TASKS.md#阶段2身份学校和班级) 为准；环境与运行方式见[开发指引](DEVELOPMENT.md)。
