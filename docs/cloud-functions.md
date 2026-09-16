# 云函数接口与部署包

更新：2026-09-16。对应阶段 1、TASK-200～202 与音频用户侧 TASK-300～303。资料更新、三级目录、事务选班、音频读取/进度/收藏和播放器已实现；本文描述本地代码与验证结果，尚未部署云函数或使用真实微信身份联调。用户已明确正式 AppID 与关联云环境后补。

相关入口：[开发指引](DEVELOPMENT.md) · [数据库初始化](database.md) · [安全规则](security-rules.md) · [依赖审计](dependency-audit.md) · [实施计划](implementation-plan.md)。

## 1. 六个领域函数

源码入口为 `cloudfunctions/<name>/index.ts`，均导出 `main`，使用同一套[请求处理器](../cloudfunctions/_shared/handler.ts)。

| 函数            | 已注册 action                                                                                                                                                                       | 当前行为                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `authApi`       | `login`、`getProfile`、`health`、`updateProfile`、`requestDelete`                                                                                                                   | `login/getProfile/health/updateProfile` 已实现；`requestDelete` 仍返回 `NOT_IMPLEMENTED`    |
| `classApi`      | `listSchools`、`listGrades`、`listClasses`、`selectClass`、`getCurrentClass`                                                                                                        | 五个 action 已实现，目录按活跃状态和父级过滤，选班为事务写入                                |
| `audioApi`      | `list`、`detail`、`saveProgress`、`history`、`toggleFavorite`、`listFavorites`                                                                                                      | 已实现可信范围内的已发布内容、短期媒体 URL、进度、历史和幂等收藏；真实云/存储待验           |
| `letterApi`     | `createDraft`、`updateDraft`、`submit`、`listPublic`、`detail`、`listMine`、`withdraw`、`delete`、`report`                                                                          | 文字草稿、提交、本人查询、撤回与软删除已实现；图片禁用；公开列表和举报仍 `NOT_IMPLEMENTED`，详见 [家书接口](letters.md) |
| `adminAudioApi` | `prepareUpload`、`confirmUpload`、`cancelUpload`、`cleanupUploads`、`createDraft`、`updateDraft`、`publish`、`offline`、`delete`、`listManage`、`detail`                            | 服务端与管理页面已接线；本地体验通过，真实云存储待验                                        |
| `adminApi`      | `listPendingLetters`、`reviewLetter`、`listReports`、`handleReport`、`createGrade`、`createClass`、`updateClass`、`grantAdmin`、`revokeAdmin`、`getConfig`、`setConfig`、`listLogs` | 先验证服务端管理员；`grantAdmin` / `revokeAdmin` 额外要求超管；通过后返回 `NOT_IMPLEMENTED` |

权限检查不通过时返回对应权限错误，不会返回 `NOT_IMPLEMENTED`。未知 action 返回 `INVALID_ARGUMENT`，没有客户端 bootstrap 接口。尚未实现的接口不会返回空列表或模拟写入成功，也不会更改业务记录。

## 2. 请求与统一返回

请求契约位于 [shared/errors.ts](../shared/errors.ts)：

```typescript
interface CloudActionRequest<TPayload = unknown> {
  action: string;
  payload?: TPayload;
  requestId?: string;
}

type ApiResult<T> =
  | { success: true; data: T; requestId: string }
  | {
      success: false;
      error: { code: ErrorCode; message: string; requestId: string };
      requestId: string;
    };
```

- `action` 必须符合已注册名称；`payload` 可省略，提供时必须为对象。
- 服务端为每次调用生成新的 UUID `requestId`，不将客户端提供的请求 ID 原样写入服务端日志。失败结果的顶层与 `error.requestId` 相同。
- 客户端通过 [auth.service.ts](../miniprogram/services/auth.service.ts) 等 service 调用云函数，页面不直接调用 `wx.cloud.callFunction`。
- [cloud-client.ts](../miniprogram/services/cloud-client.ts) 校验返回结构、解析未知值、限制等待时间、映射统一错误文案；当前不自动重试请求，避免非幂等写重复执行。

## 3. 登录与档案

### `authApi.login`

输入：无需业务 payload。身份仅来自服务端 SDK 的 `getWXContext().OPENID`；客户端传入的 OpenID、角色、授权学校或环境值均不参与登录身份及默认角色生成。

[登录实现](../cloudfunctions/authApi/login.ts)先按可信 OpenID 查找用户：

1. 已存在时读取原记录，保留昵称、角色、授权学校和选班信息。
2. 不存在时使用确定性 `_id`，以原子 `collection.add` 创建 `role=user`、`status=active`、默认昵称“夜话听友”的用户。创建和更新时间由服务端生成，数据库存储为 `Date`。
3. 并发唯一冲突或写入成功后响应中断时，再次读取已经持久化的用户；没有实际用户记录可恢复时，仍返回失败。禁止通过 `set` 覆盖已有用户。

确定性 `_id` 不能替代数据库唯一索引，部署前必须按[数据库初始化](database.md)创建 `users.openid` 唯一索引。数据库适配器校验 SDK 错误标记，新增用户的回执必须含与目标一致的 `_id`；空回执或错误 ID 不能当作创建成功。查到重复 OpenID 或非法数据库字段时失败关闭，不任取其中一个账号。

### `authApi.getProfile`

输入：无需业务 payload。每次重新读取可信 OpenID 对应的用户；不存在时返回 `UNAUTHORIZED`，不创建用户。

`login` 和 `getProfile` 都返回下述 `LoginResult`。这是对原任务书接口表直接返回 `User` 的细化：客户端收到白名单 DTO，同时收到可验证的首次进入步骤。

```typescript
interface UserProfile {
  _id: string;
  nickname: string;
  avatarFileId?: string;
  avatarPreset?: 'moon' | 'book' | 'bamboo';
  identity?: 'student' | 'parent' | 'teacher';
  role: 'user' | 'admin' | 'super_admin';
  adminSchoolId?: string;
  currentSchoolId?: string;
  currentGradeId?: string;
  currentClassId?: string;
  status: 'active' | 'disabled' | 'deleted';
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

interface LoginResult {
  user: UserProfile;
  onboardingStep: 'identity' | 'class' | 'ready';
}
```

DTO 不含 OpenID、删除操作者或其他数据库内部字段；通过白名单重新构造，未来向数据库增加字段也不会自动泄漏到响应。日期转换为 ISO 字符串。客户端的 `parseLoginResult` 会校验字段、枚举、时间及 onboarding 一致性。

| 条件                                              | `onboardingStep` |
| ------------------------------------------------- | ---------------- |
| 尚无 identity                                     | `identity`       |
| 已有 identity，但 school / grade / class 任一缺失 | `class`          |
| identity 和三个当前组织字段完整                   | `ready`          |

上述步骤只用于导航，不授予权限。阶段 2 已实现身份表单与三级选班；`getCurrentClass` 另检查当前组织是否仍然有效，不把三个 ID 齐全当作组织永久有效的证明。

### 账号状态

- `active`：正常登录。
- `disabled`：允许登录和读取本人档案，以展示受限状态；投稿及管理写守卫返回 `USER_DISABLED`。
- `status=deleted` 或 `deletedAt` 非空：返回 `USER_DELETED`，不重新创建替代账号。

## 3.1 阶段 2 资料与班级接口

| action                     | 输入 payload                                     | 输出 data                          |
| -------------------------- | ------------------------------------------------ | ---------------------------------- |
| `authApi.updateProfile`    | 必填 `identity`；可选 `nickname`、`avatarPreset` | `LoginResult`                      |
| `classApi.listSchools`     | 可选 `cursor`、`pageSize`                        | `CursorPage<SchoolOption>`         |
| `classApi.listGrades`      | `schoolId`；可选 `cursor`、`pageSize`            | `CursorPage<GradeOption>`          |
| `classApi.listClasses`     | `schoolId`、`gradeId`；可选 `cursor`、`pageSize` | `CursorPage<ClassOption>`          |
| `classApi.selectClass`     | `schoolId`、`gradeId`、`classId`                 | `LoginResult`                      |
| `classApi.getCurrentClass` | 无业务字段                                       | `{school, grade, class}` 或 `null` |

资料更新严格拒绝白名单外字段，包括 `role`、`status`、各学校授权 / 当前组织字段及任意 `avatarFileId`。昵称最多 80 个 UTF-16 字符，拒绝控制字符，空白昵称回落“夜话听友”。头像采用可选的内置 `moon/book/bamboo` 样式；自定义图片上传尚未实现。旧档案的 avatarFileId 读取兼容仍保留，但不能通过资料接口伪造其他用户的文件。

目录只返回活跃、未删除的组织；班级额外限制 `joinMode=free`。默认每页 20 项，最多 100 项，以 `_id` 升序翻页，返回 `{items, nextCursor?}`；前端提供逐级“加载更多”。游标包含版本、父级范围和最后 ID，格式及范围需匹配；它不是权限凭据，不能改变服务端按当前请求重新验证的父级过滤。DTO 字段见 [shared/domain.ts](../shared/domain.ts)，不返回数据库内部字段。

选择班级时在同一事务内重新检查真实用户的活跃状态和身份、三级组织的状态与归属，再更新用户 current*、以确定性 user/class ID upsert 成员关系，并写 `class_switch` 审计。保留 `adminSchoolId` 和历史其他班级关系；已是当前班且成员状态一致时不重复写日志。修改身份会在同事务同步当前有效成员的身份，其他历史成员保留加入时身份，不盲造缺失成员。

`getCurrentClass` 从真实用户的 current* 读取，当前组织缺失、停用、毕业、非自由加入或父子不匹配均返回 `null`，客户端提示重新选择。它不接受客户端传入任意用户或班级作为查询目标。`profile_update` 与 `class_switch` 的审计失败会让本次业务事务回滚。

生产数据库显式使用 `throwOnNotFound:false`，让首次选班缺失成员文档能进入创建分支；事务仍验证用户 / 成员更新回执、成员 / 审计新增 ID，以及事务提交回执。实际 wx SDK 的离线传输边界已测试；真实云事务冲突、索引与查询语义仍需开发环境验证。详情见[第二阶段实现与验收](stage-2.md)。

## 4. 开发健康检查

`authApi.health` 无需业务 payload，执行顺序为：

1. 检查**云函数服务端**环境变量 `APP_ENV`，仅 `dev` / `test` 放行；`prod`、未配置或其他值均返回 `FORBIDDEN`。
2. 读取 `getWXContext().ENV`，必须存在有效字符串。
3. 通过真实 SDK 查询 `system_configs` 中 `_id=app:global` 的位置，只验证查询返回结构，不返回记录内容。
4. 成功时返回以下 data：

```typescript
interface HealthResult {
  environment: 'dev' | 'test';
  cloudEnvId: string;
  database: 'reachable';
  checkedAt: string; // 服务端 ISO 时间
}
```

缺少运行环境、SDK 调用失败或数据库返回异常时失败；即使返回对象附带 `data`，只要存在 SDK 错误标记也会拒绝，不退回固定成功结果。查询允许结果为空，因此 health 成功仅表示对应数据库查询可达，**不证明种子存在、索引就绪、规则正确或微信用户身份已验证**。health 不要求 OpenID，不能替代真实小程序登录联调。

`APP_ENV` 需在实际部署平台配置；本地构建用的 `SHIXUE_ENV` 不会自动变成云端 `APP_ENV`。当前构建包不会替操作者选择云环境或设置运行时环境变量，生产部署必须明确设为 `APP_ENV=prod`。

## 5. 服务端权限与日志

[runtime.ts](../cloudfunctions/_shared/runtime.ts) 延迟初始化 `wx-server-sdk`：从可信上下文取出当前部署环境 `ENV`，校验为字符串后传入 `cloud.init`。不接收客户端指定服务端数据库环境，也不通过客户端保存管理员密钥。

[auth.ts](../cloudfunctions/_shared/auth.ts) 每次管理请求重新读取用户与状态：

- 普通用户不能通过 payload 中的角色或学校提权。
- 普通管理员必须有 `adminSchoolId`，该学校须存在、启用且未删除；请求指定目标学校时必须与授权一致。
- `currentSchoolId` 仅为用户自选的使用上下文，不能用于管理授权；改选学校不会扩大管理员权限。
- 超级管理员可以跨校，但提供目标学校时仍须检查其存在和状态。
- 角色撤销后，下一次管理请求重新读取并拒绝；不存在跨请求的服务端角色缓存。

音频读取和管理员音频服务端动作均依据数据库资源学校复核权限，不能只检查请求附带的 `schoolId`；家书及其余管理写入仍待实现时也必须遵循同一规则。数据库和存储初始默认拒绝规则见[安全规则](security-rules.md)。

[audit.ts](../cloudfunctions/_shared/audit.ts) 区分两类记录：

- 控制台请求日志仅有函数领域、已解析动作、服务端 requestId、结果和错误码；不输出 payload、OpenID、SDK 异常原文或堆栈。
- 管理审计写入受保护的 `admin_logs`，保留可信操作者、目标和请求 ID；`before/after` 仅接收有限状态字段，去掉正文、联系方式、文件 URL、令牌与任意嵌套数据。操作者 OpenID 仅用于受保护审计，不返回客户端；审计写入必须收到有效的新增 ID 回执。后续真实管理状态变化必须与审计可靠地一起提交。首次超管脚本另使用事务，验证角色更新和永久审计的写入回执，详见[数据库说明](database.md)。

[pagination.ts](../cloudfunctions/_shared/pagination.ts) 提供备用的 HMAC 签名游标工具，签名密钥须由服务端注入，至少 32 字节，不设真实默认值；当前音频接口未使用该工具。

音频列表、历史、收藏和管理列表使用 [audio-common.ts](../cloudfunctions/_shared/audio-common.ts) 的范围绑定游标，默认每页 20 条，上限 100 条。游标为未签名的 base64url 数据，服务端校验结构、排序位置、快照和查询范围，但不将其视作授权凭证；每次请求均重新根据可信用户与资源检查访问权限。家书分页仍未实现。

## 6. 主要错误

| 错误码                                           | 当前触发场景                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `UNAUTHORIZED`                                   | 缺少可信 OpenID，或需要已登录档案但用户不存在                       |
| `FORBIDDEN`                                      | 角色不满足、管理员无授权学校、非超管请求授权动作，或禁止执行 health |
| `USER_DISABLED` / `USER_DELETED`                 | 账号状态受限 / 已删除                                               |
| `SCHOOL_SCOPE_DENIED`                            | 普通管理员尝试访问其他学校                                          |
| `SCHOOL_NOT_AVAILABLE`                           | 待验证学校不存在、停用或软删除                                      |
| `INVALID_ARGUMENT`                               | 非法请求、未知 action、非法 ID 或游标                               |
| `NOT_IMPLEMENTED`                                | 基础守卫通过，但对应业务 TASK 尚未实现                              |
| `INTERNAL_ERROR`                                 | 未分类的 SDK、持久化或内部异常                                      |
| `INVALID_RESPONSE` / `TIMEOUT` / `NETWORK_ERROR` | 客户端响应解析、超时或传输失败                                      |

完整保留错误码及固定中文文案以 [shared/errors.ts](../shared/errors.ts) 为准。不会将内部堆栈或平台敏感错误直接展示给用户。

## 7. 构建、运行依赖与部署边界

在仓库根目录执行：

```bash
npm run build:cloud
npm run check:cloud
```

[build-cloud.ts](../scripts/build-cloud.ts) 只清理任务专用的 `dist/cloudfunctions/`，将六个入口及共享源码分别打包为 CommonJS `index.js`；编译目标为 Node 22，`wx-server-sdk` 保留为明确的外部生产依赖。实际云运行时仍须在目标环境选择并核验，不能把编译目标当作平台已经部署的版本。

每个包包含：

```text
dist/cloudfunctions/<name>/
├── index.js
├── package.json
├── package-lock.json
├── vendor/
│   └── shixue-lodash-set-safe-1.0.1.tgz
└── config.json
```

运行清单与锁文件来自 [config/cloud-runtime/](../config/cloud-runtime/package.json)，当前保留 `wx-server-sdk@4.0.2`，并通过精确覆盖和包内 vendor 适配器修复其生产依赖。构建前校验根依赖、运行清单及运行锁文件的 SDK 版本一致；不一致时失败。每个包都复制运行清单、锁文件和完整 `vendor/`，本地文件依赖只引用包内文件。共享模块被打进各入口，不依赖包外 `_shared`，根目录开发工具也不进入运行清单。`config.json` 目前仅有空的 OpenAPI 权限清单，没有上传或内容安全 API 授权。

`build:cloud` 不安装各包的 `node_modules`。正式部署方案需要按每个包的运行锁文件执行 `npm ci --omit=dev`，或确认所选平台安装方式确实遵守锁文件；只上传上述构建产物，不直接上传 `.ts` 源码。部署涉及环境选择、运行时及环境变量，当前没有已验收的自动部署命令。

[check:cloud](../scripts/check-cloud-packages.ts) 从实际 `dist/cloudfunctions/` 取产物，逐字节核对六包的清单、锁文件及 vendor 一致性；随后在仓库外临时目录按实际部署锁文件执行生产依赖 `npm ci` 与审计，再逐一加载六个入口并确认导出 `main`。本轮六包验证和实际部署依赖审计全部通过，未调用真实云 API；不能据此证明平台运行时、AppID 权限或业务调用成功。

SDK 或补丁升级时同时更新根依赖、运行锁文件和必要的 vendor 制品，重建六个包并回归。当前根生产依赖、实际部署包和小程序依赖审计均为 0；根全量依赖仍有 17 项 moderate，high / critical 为 0。补丁、兼容验证和剩余项见[依赖审计](dependency-audit.md)，不能表述为所有依赖风险已清除。

## 8. 本地验证与后续真实验收

本地测试位于 [tests/backend/](../tests/backend/auth.test.ts)，覆盖并发 / 重复登录、插入冲突恢复、伪造身份、角色与学校范围、撤权、账号状态、日期及响应校验、错误脱敏、游标，以及 SDK 适配和入口接线。repository 和 SDK 测试替身仅存在于测试中，没有生产失败时转为 mock 成功的开关。

阶段 1 本地统一入口为 `npm run verify:stage1`，串联完整质量检查、格式检查、实际云包校验、两个数据库 dry-run、生产依赖审计和模拟器检查；各子命令均已实际验证。全仓结果统一见[实施计划](implementation-plan.md)与[测试记录](test-cases.md)，服务端 / 数据库 96 项目标测试及本轮回执修复见[独立验收复核](acceptance-review.md)。

取得可用 AppID 和开发环境后，按顺序补验收：

1. 确认关联环境、开发者权限、实际运行时和服务端 `APP_ENV`；部署同版构建产物。
2. 按[数据库指引](database.md)建立默认拒绝规则、集合、唯一索引和开发种子，并重复初始化验证幂等。
3. 从小程序调用 health，保存非敏感环境证据、时间和服务端 requestId；再用真实微信账号调用 login / getProfile，验证重复和并发登录只有一个用户。
4. 从服务端确认已有可信账号，再运行受控首次超管脚本；验证授权、撤权和审计。禁止凭虚构 OpenID 造管理员。
5. 按[安全规则验收](security-rules.md#3-真实开发环境验收)检查客户端直接访问被拒绝，并记录真机与真实云结果。

以上真实环境步骤本轮尚未执行，阶段 1 云端验收继续保持待办。
