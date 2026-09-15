# 实学夜话 V0.1 Codex开发任务书

**用途：作为Codex在代码仓库中的直接开发基线**

| 文档项 | 内容 |
|---|---|
| 项目 | 实学夜话 |
| 版本 | V0.1 |
| 客户端 | 微信原生小程序 + TypeScript + TDesign Miniprogram |
| 后端 | 微信云开发 CloudBase |
| 项目属性 | 个人主体、非商业、单校试点、多校结构预留 |
| 核心模块 | 夜话音频、一封家书、班级、我的、管理中心 |
| 编制日期 | 2026年8月28日 |

> Codex必须把本任务书视为实现约束，而不是灵感参考。遇到未定义细节时，优先选择简单、可测试、安全、符合微信原生能力的方案，不得自行扩大产品范围。

> 2026-09-15 开发准备补充：统一文档路径、管理员授权学校、配置存储、初始安全规则及 Node 基线；保留原 TASK 编号和产品范围。参见[实施计划](implementation-plan.md)、[开发决策](decisions.md)和[开发指引](DEVELOPMENT.md)。

# 1. Codex执行总则

## 1.1 开始编码前

1. 先完整阅读本任务书和产品需求文档。
2. 检查现有仓库结构、package.json、project.config.json、云开发目录和已有代码。
3. 不覆盖已有有效代码，不删除未知文件，不擅自更换技术栈。
4. 先输出仓库现状、缺口和执行顺序，再开始修改。
5. 每次只完成一个可验证任务；任务完成后运行检查并记录结果。
6. 若仓库为空，按本任务书初始化；若仓库已有基础，按增量方式接入。

## 1.2 硬性约束

- 不引入Taro、uni-app、React小程序框架或独立Web后台。
- 不引入FastAPI、PostgreSQL、Redis、Docker或独立服务器。
- 不实现用户上传音频、评论、私信、关注、支付、广告和排行榜。
- 不把管理员权限只做成前端隐藏。
- 不信任客户端提交的OpenID、role、schoolId、审核状态和发布时间。
- 不在客户端或仓库中提交SecretId、SecretKey、AppSecret等密钥。
- 不使用`any`逃避类型设计；第三方边界必须先按`unknown`接收并校验。
- 不创建“假接口”或只返回固定数据来冒充完成。
- 不用物理删除替代软删除，除非清理未绑定临时文件。
- 不把错误堆栈直接展示给用户。

## 1.3 每项任务的完成标准

每个任务必须同时包含：

- 实际代码与必要配置。
- 输入校验和权限校验。
- 加载、空状态、错误状态。
- 单元测试或可执行的最小验证脚本。
- 对应README或代码注释。
- 不破坏已完成流程。
- 变更说明和验证结果。

# 2. 技术基线

## 2.1 前端

```text
微信原生小程序
TypeScript strict
WXML + WXSS
TDesign Miniprogram
MobX Miniprogram（只用于用户和播放器全局状态）
微信原生音频、文件选择、图片选择和云开发API
```

若现有仓库已使用稳定的自定义Store，可以保留，不强制迁移MobX；但全局用户和播放器状态必须有唯一数据源。

## 2.2 后端

```text
CloudBase云函数：Node.js 24 LTS基线（具体runtime标识在TASK-003核验并锁定）
CloudBase文档型数据库
CloudBase云存储
CloudBase安全规则
CloudBase定时触发器或清理函数
微信当前官方内容安全能力
```

若目标CloudBase环境不支持Node.js 24，核验仍受支持的Node.js 22 LTS作为回退，全部云函数保持一致。不新部署已EOL的Node.js 20。本地Node版本与云端部署结果分别验证；官方依据及核验日期见[开发决策 DEC-007](decisions.md#dec-007-node-基线更新)。

## 2.3 质量工具

- ESLint。
- Prettier。
- TypeScript类型检查。
- 云函数单元测试：Vitest或Jest二选一，优先沿用仓库现状。
- 前端纯函数与Store测试。
- 测试数据和真实环境配置分离。

# 3. 推荐仓库结构

```text
shixueyehua/
├─ miniprogram/
│  ├─ app.ts
│  ├─ app.json
│  ├─ app.wxss
│  ├─ sitemap.json
│  ├─ pages/
│  │  ├─ launch/
│  │  ├─ onboarding/
│  │  ├─ class-select/
│  │  ├─ night-talk/
│  │  ├─ audio-detail/
│  │  ├─ letters/
│  │  ├─ letter-detail/
│  │  ├─ write-letter/
│  │  ├─ my-letters/
│  │  ├─ class/
│  │  └─ profile/
│  ├─ package-admin/pages/
│  │  ├─ home/
│  │  ├─ audio-create/
│  │  ├─ audio-manage/
│  │  ├─ letter-review/
│  │  ├─ class-manage/
│  │  ├─ admin-manage/
│  │  └─ settings/
│  ├─ components/
│  │  ├─ app-navbar/
│  │  ├─ audio-card/
│  │  ├─ audio-player/
│  │  ├─ mini-player/
│  │  ├─ letter-card/
│  │  ├─ empty-state/
│  │  ├─ error-state/
│  │  └─ status-tag/
│  ├─ services/
│  │  ├─ cloud-client.ts
│  │  ├─ auth.service.ts
│  │  ├─ class.service.ts
│  │  ├─ audio.service.ts
│  │  ├─ letter.service.ts
│  │  └─ admin.service.ts
│  ├─ stores/
│  │  ├─ user.store.ts
│  │  └─ player.store.ts
│  ├─ types/
│  │  ├─ api.ts
│  │  ├─ user.ts
│  │  ├─ school.ts
│  │  ├─ audio.ts
│  │  ├─ letter.ts
│  │  └─ admin.ts
│  ├─ constants/
│  │  ├─ routes.ts
│  │  ├─ enums.ts
│  │  └─ errors.ts
│  └─ utils/
│     ├─ validator.ts
│     ├─ format.ts
│     ├─ permission.ts
│     ├─ storage.ts
│     └─ logger.ts
├─ cloudfunctions/
│  ├─ authApi/
│  ├─ classApi/
│  ├─ audioApi/
│  ├─ letterApi/
│  ├─ adminAudioApi/
│  ├─ adminApi/
│  └─ _shared/
│     ├─ auth.ts
│     ├─ result.ts
│     ├─ errors.ts
│     ├─ validate.ts
│     ├─ db.ts
│     ├─ audit.ts
│     └─ content-safety.ts
├─ scripts/
│  ├─ init-database.ts
│  ├─ create-indexes.ts
│  ├─ seed-dev-data.ts
│  ├─ bootstrap-super-admin.ts
│  └─ cleanup-orphan-files.ts
├─ docs/
│  ├─ PRD.md
│  ├─ cloud-functions.md
│  ├─ database.md
│  ├─ release-checklist.md
│  └─ test-cases.md
├─ AGENTS.md
├─ package.json
├─ tsconfig.json
├─ eslint.config.js
├─ prettier.config.js
├─ project.config.json
├─ cloudbaserc.json
└─ README.md
```

若微信云函数部署不支持直接引用`../_shared`，必须采用构建脚本复制共享模块到各函数，或将共享模块封装为本地npm包；不得在六个函数中手工复制并逐渐漂移。

# 4. 架构与编码规范

## 4.1 云函数路由

每个领域云函数接收：

```typescript
interface CloudActionRequest<TPayload = unknown> {
  action: string;
  payload?: TPayload;
  requestId?: string;
}
```

统一返回：

```typescript
interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId: string;
  };
}
```

云函数入口必须执行：

```text
生成/读取requestId
  → 获取可信OpenID
  → 解析action
  → 校验payload
  → 按需要加载用户与角色
  → 校验学校范围
  → 执行业务
  → 写日志
  → 返回统一结果
```

## 4.2 权限辅助函数

至少实现：

```typescript
requireLogin(context): Promise<AuthUser>
requireActiveUser(openid): Promise<User>
requireAdmin(openid, schoolId?): Promise<User>
requireSuperAdmin(openid): Promise<User>
assertSameSchool(actor, resourceSchoolId): void
```

任何管理action不得直接读取`payload.role`决定权限。

管理员的授权学校取自服务端用户记录的`adminSchoolId`，不得取用户可自行切换的`currentSchoolId`。`admin`缺少授权字段或目标资源学校不匹配时拒绝；`super_admin`仍须校验目标学校与资源有效。客户端提交的schoolId仅可作为待校验的选择或目标，不能成为授权依据。

## 4.3 客户端服务层

所有页面通过`services/*.service.ts`调用云函数。页面不得直接散落：

```typescript
wx.cloud.callFunction({ name: 'xxx', data: ... })
```

统一封装应处理：

- 超时和重试。
- 统一错误映射。
- loading状态。
- requestId。
- 登录失效。
- 类型收窄。

## 4.4 时间与删除

- 创建和修改时间使用服务端时间。
- 查询默认排除`deletedAt != null`的数据。
- 管理员删除音频或家书只写`deletedAt`、`deletedBy`。
- 临时上传文件可以物理清理。

## 4.5 日志

管理操作日志至少包含：

```typescript
{
  operatorId,
  operatorOpenid,
  schoolId,
  action,
  targetType,
  targetId,
  before,
  after,
  requestId,
  createdAt
}
```

日志中的before/after应移除正文全文、OpenID之外的无关敏感字段和大文件URL，避免日志膨胀。

# 5. 核心类型与数据结构

## 5.1 用户

```typescript
type UserIdentity = 'student' | 'parent' | 'teacher';
type UserRole = 'user' | 'admin' | 'super_admin';
type UserStatus = 'active' | 'disabled' | 'deleted';

interface User {
  _id: string;
  openid: string;
  nickname: string;
  avatarFileId?: string;
  identity?: UserIdentity;
  role: UserRole;
  adminSchoolId?: string; // 仅服务端授权写入，与用户自选学校分离
  currentSchoolId?: string;
  currentGradeId?: string;
  currentClassId?: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

## 5.2 音频

```typescript
type AudioStatus = 'draft' | 'published' | 'offline' | 'deleted';
type Visibility = 'school' | 'classes'; // V0.1不开放跨校公开音频

interface AudioProgram {
  _id: string;
  schoolId: string;
  classIds: string[];
  title: string;
  description: string;
  speakerName: string;
  speakerTitle: string;
  coverFileId: string;
  audioFileId: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize: number;
  duration: number;
  visibility: Visibility;
  status: AudioStatus;
  createdBy: string;
  publishedBy?: string;
  publishedAt?: Date;
  offlineAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## 5.3 家书

```typescript
type RecipientType =
  | 'child'
  | 'parent'
  | 'teacher'
  | 'classmate'
  | 'future_self'
  | 'other';

type LetterStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'hidden'
  | 'deleted';

interface Letter {
  _id: string;
  authorId: string;
  schoolId: string;
  gradeId: string;
  classId: string;
  title: string;
  recipientType: RecipientType;
  content: string;
  imageFileIds: string[];
  visibility: 'private' | 'class' | 'school';
  reviewStatus: LetterStatus;
  reviewReason?: string;
  safetyResult?: ContentSafetySummary;
  reviewedBy?: string;
  reviewedAt?: Date;
  publishedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## 5.4 配置

```typescript
interface SystemConfig {
  schoolId?: string;
  letterPublishMode: 'private' | 'reviewed_showcase' | 'community';
  enableLetterImages: boolean;
  maxLetterImages: number;
  reportAutoHideThreshold: number;
  enableClassApproval: boolean;
  enableComments: false;
  enablePrivateMessage: false;
  enablePayment: false;
  maintenanceMode: boolean;
}
```

`SystemConfig` 是读取结果，数据库保存为 `system_configs` 的 `key/value/schoolId` 记录；每个作用域使用确定性 `_id`，初始化及配置覆盖约定见[开发决策 DEC-004](decisions.md#dec-004-配置存储与读取约定)。`enableLetterImages=false` 时禁止图片；启用时按 `maxLetterImages` 校验，V0.1 最大为3。

# 6. 云函数接口清单

## 6.1 authApi

| action | 权限 | 输入 | 输出 |
|---|---|---|---|
| login | 登录上下文 | 无 | LoginResult（UserProfile + onboardingStep） |
| getProfile | 登录用户 | 无 | LoginResult（UserProfile + onboardingStep） |
| updateProfile | 登录用户 | nickname、avatarFileId、identity | User |
| requestDelete | 登录用户 | reason可选 | requestId |

TASK-103实现时将`login/getProfile`统一为`LoginResult`，客户端用户为白名单`UserProfile`，不含OpenID，时间使用ISO字符串。`User`仍为服务端数据库模型（含OpenID和Date）。`authApi.health`仅供dev/test连通诊断，详见[实际接口文档](cloud-functions.md)。

## 6.2 classApi

| action | 权限 | 输入 | 输出 |
|---|---|---|---|
| listSchools | 登录用户 | 无 | School[] |
| listGrades | 登录用户 | schoolId | Grade[] |
| listClasses | 登录用户 | schoolId、gradeId | Class[] |
| selectClass | 登录用户 | schoolId、gradeId、classId | User |
| getCurrentClass | 登录用户 | 无 | School+Grade+Class |

## 6.3 audioApi

| action | 权限 | 输入 | 输出 |
|---|---|---|---|
| list | 登录用户 | cursor、pageSize | AudioSummaryPage |
| detail | 登录用户 | audioId | AudioDetail |
| saveProgress | 登录用户 | audioId、currentTime、duration | PlayProgress |
| history | 登录用户 | cursor | PlayProgressPage |
| toggleFavorite | 登录用户 | audioId | favorite:boolean |
| listFavorites | 登录用户 | cursor | AudioSummaryPage |

## 6.4 letterApi

| action | 权限 | 输入 | 输出 |
|---|---|---|---|
| createDraft | 登录用户 | title等可选字段 | Letter |
| updateDraft | 作者 | letterId、可编辑字段 | Letter |
| submit | 作者 | letterId | Letter |
| listPublic | 登录用户 | cursor、scope | LetterPage |
| detail | 有权限用户 | letterId | Letter |
| listMine | 登录用户 | status、cursor | LetterPage |
| withdraw | 作者 | letterId | Letter |
| delete | 作者 | letterId | success |
| report | 登录用户 | letterId、reason、detail | Report |

## 6.5 adminAudioApi

| action | 权限 | 输入 | 输出 |
|---|---|---|---|
| createDraft | 管理员 | 音频元数据与fileId | AudioProgram |
| updateDraft | 管理员 | audioId、可编辑字段 | AudioProgram |
| publish | 管理员 | audioId | AudioProgram |
| offline | 管理员 | audioId、reason可选 | AudioProgram |
| delete | 管理员 | audioId | success |
| listManage | 管理员 | status、cursor | AudioPage |

## 6.6 adminApi

| action | 权限 | 输入 | 输出 |
|---|---|---|---|
| listPendingLetters | 管理员 | cursor | LetterPage |
| reviewLetter | 管理员 | letterId、decision、reason | Letter |
| listReports | 管理员 | status、cursor | ReportPage |
| handleReport | 管理员 | reportId、decision、note | Report |
| createGrade | 管理员 | schoolId、name | Grade |
| createClass | 管理员 | gradeId、name、joinMode | Class |
| updateClass | 管理员 | classId、字段 | Class |
| grantAdmin | 超级管理员 | userId、schoolId | User |
| revokeAdmin | 超级管理员 | userId | User |
| getConfig | 管理员 | schoolId可选 | SystemConfig |
| setConfig | 管理员/超级管理员 | 配置字段 | SystemConfig |
| listLogs | 管理员 | filters、cursor | AdminLogPage |

# 7. 开发阶段与任务

# 阶段0：仓库检查与工程初始化

## TASK-000 仓库审计与执行计划

**优先级：P0**  
**依赖：无**

实施：

1. 输出当前目录树、已有技术栈、已存在页面、云函数和未提交变更。
2. 对照本任务书列出“可复用、需修改、需新增、存在冲突”。
3. 生成`docs/implementation-plan.md`，按任务编号记录状态。
4. 不修改业务代码之前，先确认小程序根目录和云函数根目录。

验收：

- 不误删现有文件。
- 计划能映射到本任务书的任务编号。
- 后续每完成一项可更新状态和验证记录。

## TASK-001 初始化小程序工程

**优先级：P0**  
**依赖：TASK-000**

实施：

1. 配置TypeScript严格模式。
2. 安装并构建TDesign Miniprogram。
3. 配置四个tabBar页面和管理员分包。
4. 创建统一主题变量、全局字体、页面背景和安全区处理。
5. 创建launch、night-talk、letters、class、profile空壳页面。
   同时注册身份与选班占位路由，使TASK-103能稳定展示待完善步骤；完整身份/选班交互仍由TASK-200/201实现。
6. 确保微信开发者工具可构建，不出现npm组件缺失。

验收：

- 工程可正常预览。
- 四个Tab可切换。
- 管理分包不进入普通首包。
- TypeScript无错误。

## TASK-002 质量工具与提交基线

**优先级：P0**  
**依赖：TASK-001**

实施：

1. 配置ESLint、Prettier和typecheck脚本。
2. 添加`npm run lint`、`npm run typecheck`、`npm test`。
3. 建立`.gitignore`，排除本地私密配置、构建产物和临时文件。
4. 添加README的本地启动、构建npm和云函数部署说明。

验收：

- 三个质量命令可执行。
- 仓库不包含密钥和本地环境ID硬编码。
- 新增代码符合统一格式。

## TASK-003 环境配置与CloudBase初始化

**优先级：P0**  
**依赖：TASK-001**

实施：

1. 在`config/env.ts`定义dev/test/prod配置接口。
2. `app.ts`初始化`wx.cloud`，环境ID由构建配置注入。
3. 云函数统一读取当前环境，不在客户端保存管理密钥。
4. 添加环境检查页或开发日志，避免误连正式环境。

验收：

- 切换环境不需修改业务源码。
- 开发环境可成功调用一个健康检查action。
- 生产环境配置不会被提交为明文密钥。

# 阶段1：共享基础、数据与鉴权

## TASK-100 领域类型、错误码与接口封装

**优先级：P0**  
**依赖：TASK-002**

实施：

1. 按本任务书建立User、School、Audio、Letter、Report等类型。
2. 实现`ApiResult<T>`、错误码常量和用户友好文案映射。
3. 实现`cloud-client.ts`，统一调用、超时、requestId和错误解析。
4. 页面只能调用service层。

验收：

- 不存在页面内散落的callFunction。
- 错误码可映射为统一Toast或错误页。
- TypeScript严格模式通过。

## TASK-101 云函数共享内核

**优先级：P0**  
**依赖：TASK-003、TASK-100**

实施：

1. 初始化云开发admin SDK和数据库引用。
2. 实现结果包装、AppError、参数验证和requestId。
3. 实现`requireLogin`、`requireAdmin`、`requireSuperAdmin`、`assertSameSchool`。
4. 实现分页游标编码/解码。
5. 实现管理操作审计函数。
6. 建立共享模块构建或复制策略。

验收：

- 六个云函数可以复用同一套鉴权和错误处理。
- 任意异常均返回统一结构。
- 云函数日志可通过requestId定位。

## TASK-102 数据库初始化、索引与种子数据

**优先级：P0**  
**依赖：TASK-101**

实施：

1. 创建users、schools、grades、classes、class_memberships、audio_programs、play_progress、favorites、letters、reports、admin_logs、system_configs、notifications。
2. 创建PRD要求的唯一索引和复合索引。
3. 编写`seed-dev-data.ts`，生成一所测试学校、两个年级、四个班级、默认配置。
4. 编写`bootstrap-super-admin.ts`，通过OpenID设置首个超级管理员。
5. 脚本必须可重复执行且不重复插入。
6. 创建集合时一并部署数据库和存储初始默认拒绝客户端访问的规则；通过云函数访问数据，上传规则在TASK-601随业务按需开放。
7. `system_configs`按作用域确定性ID写入，补齐`enableLetterImages=true`，区分存储记录与业务读取类型。
8. 超管脚本只处理已存在的可信用户，默认拒绝非开发环境；目标账号先经TASK-103真实登录，再从服务端记录取得OpenID执行授权。不得开放客户端bootstrap action，不用虚构OpenID创建真实管理员。

验收：

- 开发环境一条命令可初始化。
- 唯一索引阻止重复用户、收藏和播放进度。
- 种子数据可安全重复运行。
- 客户端直接读写受保护集合、提权或未经授权访问存储均被拒绝。
- 超管脚本对不存在用户拒绝，对已授权用户重复执行不重复授权；真实授权在TASK-103首次登录后验证。

## TASK-103 登录云函数与用户会话

**优先级：P0**  
**依赖：TASK-101、TASK-102**

实施：

1. `authApi.login`从云函数上下文获取OpenID。
2. 不存在用户时创建role=user、status=active的记录。
3. 返回需要补全的onboarding步骤。
4. 实现UserStore：loading、user、isOnboarded、isAdmin。
5. 启动页根据用户状态跳转，不出现循环跳转。
6. 身份与选班页面尚未完成时，以有效占位路由显示待完善步骤；不宣称完成选班流程。

验收：

- 同一OpenID只创建一条用户记录。
- 客户端传入伪造OpenID不起作用。
- 被disabled用户按规则受限。
- 以真实开发环境的可信用户验证首位超管脚本，确认授权与日志；不能以测试上下文替代真实登录证据。

# 阶段2：身份、学校和班级

## TASK-200 身份选择流程

**优先级：P0**  
**依赖：TASK-103**

实施：

1. 创建学生、家长、教师三种身份卡片。
2. 允许用户填写昵称和可选头像。
3. updateProfile只接受允许字段，不能修改role、status和schoolId。
   同样禁止修改adminSchoolId及currentSchoolId；当前学校只能由selectClass校验层级后设置。
4. 完成后进入班级选择。

验收：

- 未选身份不能进入主界面。
- 普通用户无法把role改成admin。
- 返回上一步不会丢失已填内容。

## TASK-201 学校、年级、班级选择与切换

**优先级：P0**  
**依赖：TASK-200**

实施：

1. 实现学校、年级、班级三级联动。
2. V0.1只展示active学校、年级和班级。
3. `selectClass`服务端校验层级关系。
4. 更新users当前班级并upsert class_memberships。
   不修改adminSchoolId；切换学校不会扩大管理员授权范围。
5. 班级切换后清理列表缓存并刷新音频、家书。
6. 写入class_switch日志。

验收：

- 不能提交不存在或跨学校的班级。
- 切换后当前班级展示正确。
- 自由加入不需要审批。

## TASK-202 页面与接口管理员守卫

**优先级：P0**  
**依赖：TASK-103**

实施：

1. 创建前端`requireAdminPage`守卫。
2. 管理分包页面onLoad和onShow均重新检查角色。
3. 所有管理action服务端调用`requireAdmin`或`requireSuperAdmin`。
4. 角色被撤销后，已打开管理页下一次操作立即失败并退出。

验收：

- 普通用户无法通过路由、调试器或直接请求完成管理操作。
- 管理员无法跨校操作。

# 阶段3：夜话音频

## TASK-300 音频查询接口

**优先级：P0**  
**依赖：TASK-201**

实施：

1. `audioApi.list`按当前schoolId、classId和visibility过滤。
2. 只返回published且未删除数据，按publishedAt倒序分页。
3. 合并当前用户的播放进度和收藏状态。
4. `audioApi.detail`再次校验可见范围和状态。
5. 文件为私有读时，按需返回短期临时访问URL。

验收：

- 草稿、下架、跨校、非目标班级内容不可见。
- 分页无重复。
- 列表接口不返回不必要的长简介或内部字段。

## TASK-301 夜话首页与音频详情

**优先级：P0**  
**依赖：TASK-300**

实施：

1. 实现“本期夜话”主卡和往期列表。
2. 卡片展示封面、标题、主讲人、日期、时长、继续收听进度。
3. 实现下拉刷新、分页、骨架、空状态和错误重试。
4. 音频详情展示完整元数据和播放入口。
5. 适配长标题、缺省封面和无简介场景。

验收：

- 真机列表滚动流畅。
- 无内容和网络错误有清晰反馈。
- 点击卡片进入正确详情。

## TASK-302 全局音频播放器

**优先级：P0**  
**依赖：TASK-301**

实施：

1. 使用微信后台音频管理能力建立单例PlayerStore。
2. 支持播放、暂停、seek、前后15秒、上一期、下一期。
3. 设置标题、歌手/主讲人、封面等锁屏元数据。
4. 在夜话、详情、家书和我的页面挂载迷你播放器。
5. 处理播放结束、加载失败、文件失效、网络变化。
6. 倍速仅在当前基础库确认支持后显示。

验收：

- 页面切换不重复创建播放器。
- 后台与锁屏场景按平台能力正常。
- 切集不会串音或保留错误进度。
- 失败可重试。

## TASK-303 播放进度、历史与收藏

**优先级：P0**  
**依赖：TASK-302**

实施：

1. 暂停、切集、页面隐藏和固定间隔保存进度。
2. 保存时限制写入频率和进度范围。
3. 达到95%标记completed。
4. 实现收听历史和收藏列表。
5. favorite使用唯一索引和幂等toggle。

验收：

- 退出后可从上次位置续播。
- 重复收藏不产生重复记录。
- 不出现每秒一次数据库写入。

## TASK-304 管理员音频上传与草稿

**优先级：P0**  
**依赖：TASK-202、TASK-300**

实施：

1. 发布页面支持选择微信可访问的音频文件。
2. 显示文件名、大小、类型、上传进度、取消和重试。
3. 客户端校验允许格式与配置大小；服务端再次校验元数据。
4. 上传路径按schoolId、年份和UUID生成，禁止使用原文件名直接拼路径。
5. 上传封面并压缩；无封面使用默认图。
6. 通过`adminAudioApi.createDraft`绑定文件和业务元数据。
7. 上传成功但建档失败时记录临时文件，进入清理任务。
8. 表单离开前提示未保存内容。

验收：

- 普通用户无法建档或发布。
- 上传中断可恢复到可重试状态。
- 草稿不会出现在普通列表。
- 临时文件有清理路径。

## TASK-305 音频发布、下架和管理列表

**优先级：P0**  
**依赖：TASK-304**

实施：

1. 管理列表按草稿、已发布、已下架筛选。
2. 发布前校验标题、音频、封面、主讲人、时长和可见范围。
3. 支持全校或指定班级可见。
4. 下架与删除要求二次确认。
5. 状态变更写admin_logs。
6. 正在播放的下架内容在下一次接口请求时显示不可用。

验收：

- 发布后普通用户可见。
- 下架后新请求不可播放。
- 管理员不能修改其他学校音频。

# 阶段4：一封家书

## TASK-400 家书草稿、更新与提交接口

**优先级：P0**  
**依赖：TASK-201、TASK-101、TASK-600**

实施：

1. 实现createDraft、updateDraft、submit、withdraw、delete。
2. 校验标题2至30字、正文20至3000字、图片0至配置上限。
3. 只允许作者编辑draft或rejected。
4. submit时从用户当前档案写入schoolId、gradeId、classId，不信任客户端。
5. 提交前调用内容安全模块。
6. 通过后状态pending；保存安全摘要。
7. 所有状态迁移使用明确状态机，拒绝非法跳转。

验收：

- 用户不能编辑他人家书。
- approved不能直接覆盖修改。
- 重复提交返回同一稳定状态，不生成重复记录。

## TASK-401 写一封家书页面

**优先级：P0**  
**依赖：TASK-400**

实施：

1. 实现标题、写给谁、正文和图片选择。
2. 实时字数、图片数量、必填校验。
3. 图片压缩后上传到`letters/{openid}/...`。
4. 提供保存草稿和提交审核两个明确按钮。
5. 页面离开时对未保存内容提示。
6. 提交中禁止重复点击。
7. 安全检查失败只展示可理解的通用提示，不展示内部标签。

验收：

- 长文输入稳定，不意外丢失。
- 最多3图的默认配置生效。
- 提交成功跳转到“我的家书”并显示pending。

## TASK-402 精选家书列表与详情

**优先级：P0**  
**依赖：TASK-400**

实施：

1. 根据letterPublishMode决定列表数据。
2. reviewed_showcase模式只返回approved且允许展示的内容。
3. 按学校和可见范围过滤。
4. 卡片展示标题、摘要、昵称、身份、日期。
5. 详情展示正文和图片预览。
6. 不实现评论、点赞排行、私信和公开用户主页。

验收：

- pending/rejected/hidden不公开。
- 不泄露OpenID、审核内部字段和联系方式。
- private模式下公开列表为空或进入说明页。

## TASK-403 我的家书

**优先级：P0**  
**依赖：TASK-400**

实施：

1. 按状态筛选本人家书。
2. 草稿/驳回可编辑，待审可撤回，已通过可查看公开效果。
3. 驳回原因清晰展示。
4. 隐藏内容显示“已隐藏”，不直接消失。
5. 删除前二次确认。

验收：

- 只能看到本人内容。
- 所有操作与云端状态一致。

## TASK-404 管理员家书审核

**优先级：P0**  
**依赖：TASK-202、TASK-400**

实施：

1. 待审列表按提交时间排序。
2. 审核详情展示必要的作者身份、班级、正文、图片和安全摘要。
3. 支持approve、reject、hide。
4. reject必须填写原因。
5. 更新reviewedBy、reviewedAt、publishedAt。
6. 使用乐观锁或当前状态条件防止双人重复审核。
7. 写入admin_logs并发送站内通知。

验收：

- 重复审核不会覆盖另一管理员已完成结果。
- 审核通过后按模式进入列表。
- 驳回原因对作者可见。

## TASK-405 举报与管理员处置

**优先级：P1**  
**依赖：TASK-402、TASK-404**

实施：

1. 家书详情提供举报弹窗。
2. 同一用户、同一目标建立去重规则。
3. 管理员查看待处理举报及目标快照。
4. 支持ignore、hide_target、warn_user等处理结果。
5. 达到配置阈值时可先隐藏待复核。
6. 处理写入report和admin_logs。

验收：

- 不能无限重复举报。
- 隐藏后公开列表立即不可见。
- 举报人不能看到管理员内部备注。

# 阶段5：管理中心与配置

## TASK-500 管理中心首页

**优先级：P0**  
**依赖：TASK-202**

实施：

1. 展示待审核数量、音频草稿数量、待处理举报数量。
2. 提供音频发布、音频管理、家书审核、班级管理、设置入口。
3. 超级管理员额外显示管理员管理。
4. 所有统计按schoolId过滤。

验收：

- 普通用户无入口且不可直达。
- 统计与实际列表一致。

## TASK-501 学校、年级和班级管理

**优先级：P1**  
**依赖：TASK-500**

实施：

1. 管理员可创建、重命名、停用本校年级和班级。
2. 超级管理员可创建学校。
3. 班级支持joinMode字段，V0.1默认free。
4. 有成员或内容关联的班级不得物理删除，只能停用或归档。
5. 变更写入日志。

验收：

- 管理员不能管理其他学校。
- 停用后用户端不再可选。
- 旧数据仍可追溯。

## TASK-502 管理员授权与撤销

**优先级：P0**  
**依赖：TASK-500**

实施：

1. 仅super_admin可搜索已登录用户并授权admin。
2. 授权时绑定schoolId。
   服务端将目标学校写入users.adminSchoolId，不修改用户当前所选学校。
3. 撤销后用户立即失去管理能力。
   撤销时清除adminSchoolId，下一次请求重新从服务端核验角色和授权。
4. 不允许撤销最后一个super_admin。
5. 所有变更写日志。

验收：

- 普通管理员不能授予权限。
- 撤销后的已打开页面下一次请求返回FORBIDDEN。

## TASK-503 系统设置与功能开关

**优先级：P0**  
**依赖：TASK-500**

实施：

1. 实现letterPublishMode、maxLetterImages、reportAutoHideThreshold、maintenanceMode等配置。
   同时实现enableLetterImages；存储与覆盖按DEC-004，学校管理员只可写明确白名单字段，所有全局配置仅超级管理员可写。
2. 前端读取配置但不以客户端配置代替服务端校验。
3. 关闭模块时展示维护状态。
4. 修改配置记录before和after。
5. enableComments、enablePrivateMessage、enablePayment固定为false，不创建对应业务。

验收：

- 切换private后公开家书不再返回。
- 配置越权修改被拒绝。

## TASK-504 管理日志与通知

**优先级：P1**  
**依赖：TASK-404、TASK-502、TASK-503**

实施：

1. 管理员按操作类型、时间和目标筛选日志。
2. 普通管理员只看本校日志。
3. 家书审核结果生成notifications。
4. “我的”页面展示未读审核消息。
5. 通知支持标记已读。

验收：

- 日志不可由客户端修改。
- 通知只返回目标用户。

# 阶段6：安全、体验与发布

## TASK-600 内容安全适配层

**优先级：P0**  
**依赖：TASK-101**

实施：

1. 建立`content-safety.ts`接口，不把具体平台调用散落在业务函数。
2. 支持文本检查和图片检查。
3. 统一输出pass、review、reject和标签摘要。
4. 外部能力失败时按配置选择“阻止提交”或“进入人工复核”，默认阻止公开提交但保留草稿。
5. 测试环境使用可控mock，正式环境调用当前官方接口。
6. 不让客户端获得底层敏感标签和调用凭据。

验收：

- 安全服务故障不会导致未检查内容直接公开。
- 单元测试覆盖通过、复核、拒绝、超时四类结果。

## TASK-601 数据库与存储安全规则

初始默认拒绝规则已要求在TASK-102落实；本任务负责随上传业务细化并完成完整规则验收。TASK-304和TASK-401的真实上传流程须同步完成对应规则后才能验收，不等待全部业务结束。

**优先级：P0**  
**依赖：TASK-102、TASK-304、TASK-401**

实施：

1. 数据库默认拒绝客户端修改users.role、音频状态、审核状态、日志和配置。
2. 公开查询仍优先通过云函数，避免客户端拼查询越权。
3. 用户图片路径按OpenID隔离。
4. 音频正式目录采用管理员可写或服务端确认机制。
5. 临时目录限制归属、文件类型和清理周期。
6. 添加安全规则说明文档和测试步骤。

验收：

- 使用开发者工具直接操作数据库无法提权。
- 普通用户不能删除他人文件。
- 正式音频不能被普通用户覆盖。

## TASK-602 错误、空状态、加载与性能

**优先级：P0**  
**依赖：所有P0业务任务**

实施：

1. 为所有页面补齐加载骨架、空状态、错误重试和禁用状态。
2. 列表分页10至20条，避免一次拉取全文和大字段。
3. 图片压缩、缩略图和懒加载。
4. 播放进度写入节流。
5. 长任务显示进度并可取消。
6. 处理弱网、切后台、重复点击和页面销毁。

验收：

- 不存在永久loading。
- 无数据时不出现空白页。
- 上传和审核重复点击不产生重复记录。

## TASK-603 自动化测试与验收脚本

**优先级：P0**  
**依赖：所有P0业务任务**

实施：

1. 测试权限辅助函数、状态机、分页游标、错误映射。
2. 测试普通用户发布音频返回FORBIDDEN。
3. 测试跨校音频和家书不可见。
4. 测试家书状态迁移。
5. 测试收藏和进度唯一性。
6. 创建`docs/test-cases.md`，包含真机步骤。
7. 提供开发数据清理脚本。

验收：

- lint、typecheck、test全部通过。
- 核心P0流程有自动化或可重复手工用例。
- 测试不依赖正式环境数据。

## TASK-604 真机测试与发布清单

**优先级：P0**  
**依赖：TASK-603**

实施：

1. 在iOS和Android验证登录、选班、播放、后台播放、上传、图片、审核。
2. 验证个人主体正式配置下所有关闭功能确实不存在。
3. 检查隐私说明、权限申请文案、sitemap和分享信息。
4. 检查云环境、管理员、学校、班级、默认配置和默认封面。
5. 运行孤立文件清理和数据备份。
6. 输出`docs/release-checklist.md`和已知问题。

验收：

- PRD P0验收项全部通过。
- 没有P0/P1未处理安全缺陷。
- 正式环境无测试管理员、测试家书和无效音频。

# 8. 数据库初始化要求

## 8.1 默认配置

```json
{
  "letterPublishMode": "reviewed_showcase",
  "enableLetterImages": true,
  "maxLetterImages": 3,
  "reportAutoHideThreshold": 3,
  "enableClassApproval": false,
  "enableComments": false,
  "enablePrivateMessage": false,
  "enablePayment": false,
  "maintenanceMode": false
}
```

## 8.2 开发种子数据

- 学校：实学实验学校。
- 年级：七年级、八年级。
- 班级：每个年级一班、二班。
- 音频：一条已发布、一条草稿、一条下架。
- 家书：draft、pending、approved、rejected各一条。
- 真实开发环境测试用户由TASK-103首次登录创建；种子只引用已存在的可信用户，OpenID通过本地配置注入。管理员与超级管理员由受控授权步骤赋予，seed不创建真实账号或管理员。虚构用户仅用于隔离自动化测试，不写入真实云环境。

# 9. 错误码实现要求

| 错误码 | HTTP语义 | 客户端文案方向 |
|---|---|---|
| UNAUTHORIZED | 401 | 登录状态已失效，请重新进入 |
| FORBIDDEN | 403 | 当前账号没有此操作权限 |
| USER_DISABLED | 403 | 当前账号暂时无法执行该操作 |
| INVALID_ARGUMENT | 400 | 请检查填写内容 |
| SCHOOL_SCOPE_DENIED | 403 | 无法访问其他学校的数据 |
| CLASS_NOT_AVAILABLE | 409 | 该班级当前不可选择 |
| AUDIO_NOT_FOUND | 404 | 这期夜话已下架或不存在 |
| UPLOAD_FAILED | 500/502 | 上传失败，请重试 |
| CONTENT_REJECTED | 422 | 内容暂时无法提交，请修改后重试 |
| LETTER_STATE_CONFLICT | 409 | 当前状态不能执行此操作 |
| DUPLICATE_REQUEST | 409 | 请勿重复提交 |
| RATE_LIMITED | 429 | 操作过于频繁，请稍后再试 |
| INTERNAL_ERROR | 500 | 系统开小差了，请稍后再试 |

# 10. 必测场景

| 编号 | 场景 | 预期 |
|---|---|---|
| TC-001 | 首次登录两次 | 只创建一个用户 |
| TC-002 | 客户端伪造OpenID | 服务端忽略 |
| TC-003 | 普通用户调用publish | FORBIDDEN |
| TC-004 | 管理员操作其他schoolId | SCHOOL_SCOPE_DENIED |
| TC-005 | 音频草稿查询 | 普通列表不可见 |
| TC-006 | 指定班级音频 | 仅目标班级可见 |
| TC-007 | 播放至50%退出 | 再进入从附近进度恢复 |
| TC-008 | 重复收藏 | 数据库只有一条收藏 |
| TC-009 | 家书草稿提交 | draft→pending |
| TC-010 | 待审再次提交 | 不重复创建 |
| TC-011 | 管理员驳回不填原因 | INVALID_ARGUMENT |
| TC-012 | 双管理员同时审核 | 只有一个成功变更 |
| TC-013 | approved家书直接编辑 | LETTER_STATE_CONFLICT |
| TC-014 | private模式公开列表 | 不返回家书 |
| TC-015 | 同一用户重复举报 | 合并或拒绝重复 |
| TC-016 | 音频上传中断 | 可重试，无公开半成品 |
| TC-017 | 管理员撤权后继续操作 | 下一请求FORBIDDEN |
| TC-018 | 班级停用后选择 | CLASS_NOT_AVAILABLE |
| TC-019 | 内容安全接口超时 | 不直接公开，保留草稿 |
| TC-020 | 弱网列表失败 | 显示错误并可重试 |

# 11. Codex每轮工作输出格式

每完成一个任务，Codex应输出：

```text
任务：TASK-XXX
状态：完成 / 部分完成 / 阻塞
修改文件：
- path/to/file
- path/to/file

实现摘要：
- ...

验证：
- npm run lint：通过/失败
- npm run typecheck：通过/失败
- npm test：通过/失败
- 其他验证：...

已知限制：
- ...

下一项：TASK-YYY
```

不得只说“已完成”而不列出文件和验证结果。

# 12. 推荐AGENTS.md内容

将以下内容放入仓库根目录`AGENTS.md`：

```markdown
# 实学夜话 Codex Rules

## Product boundary
- The app is a WeChat Mini Program for school audio and reviewed family letters.
- Only admin/super_admin may upload or publish audio.
- Normal users may submit text-and-image letters, but public display requires review.
- Do not add comments, private messages, payment, ads, user audio upload, followers, rankings, or a Web admin panel.

## Stack
- Native WeChat Mini Program + TypeScript strict.
- TDesign Miniprogram.
- CloudBase functions, document database, storage, and security rules.
- No FastAPI, PostgreSQL, Redis, Docker, Taro, or uni-app.

## Security
- Never trust client OpenID, role, schoolId, reviewStatus, or publish status.
- All privileged writes go through cloud functions.
- Every admin action must verify role and school scope server-side.
- Never commit secrets.
- Use soft delete for business records.

## Code quality
- No unvalidated any.
- Pages call services; services call cloud functions.
- Use shared types, error codes, validation, and audit logging.
- Run lint, typecheck, and tests after each task.
- Preserve existing code unless replacement is necessary and documented.

## Delivery
- Work by TASK IDs in docs/CODEX_TASKS.md.
- For each task, list changed files, tests run, and known limitations.
- Do not claim completion when tests fail or the flow is only mocked.
```

# 13. 给Codex的首轮启动提示词

```text
请先阅读仓库根目录 AGENTS.md、docs/PRD.md 和 docs/CODEX_TASKS.md。

当前目标不是一次性写完整项目，而是：
1. 审计仓库现状；
2. 完成 TASK-000；
3. 输出 implementation-plan.md；
4. 在没有发现阻断性冲突时继续完成 TASK-001；
5. 运行 lint、typecheck 和可执行测试；
6. 按任务书规定的格式报告结果。

不要更换技术栈，不要加入PRD明确不做的功能，不要把管理员权限只放在前端。遇到CloudBase或微信API版本差异时，以当前官方文档为准，并把差异记录在docs/decisions.md。
```

# 14. 最终交付清单

- 可在微信开发者工具打开并构建的小程序源码。
- 可部署的CloudBase云函数。
- 数据库初始化、索引、种子和超级管理员脚本。
- 数据库及存储安全规则。
- 完整的README、环境说明、接口说明和发布清单。
- lint、typecheck、test通过记录。
- iOS与Android真机核心流程结果。
- 已知问题与后续任务列表。

完成V0.1时，代码必须能真实走通“登录选班 → 收听夜话 → 保存进度 → 投稿家书 → 管理员审核 → 精选展示”的完整闭环。
