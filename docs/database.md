# 数据库初始化与首次超管授权

对应 TASK-102。当前已实现可运行脚本及本地自动化测试，**尚未执行真实云端初始化、规则部署或管理员授权**。本地测试不证明云端唯一索引或事务已生效。

## 1. 文件与约定

| 文件                                                            | 作用                                   |
| --------------------------------------------------------------- | -------------------------------------- |
| [manifest.ts](../scripts/database/manifest.ts)                  | 13 个集合、索引清单和默认拒绝规则      |
| [init-database.ts](../scripts/init-database.ts)                 | 预览 / 开发环境初始化命令              |
| [seed-dev-data.ts](../scripts/database/seed-dev-data.ts)        | 虚构学校、2 个年级、4 个班级和全局配置 |
| [bootstrap-super-admin.ts](../scripts/bootstrap-super-admin.ts) | 已真实登录用户的首次受控授权           |
| [core.ts](../scripts/database/core.ts)                          | 幂等、环境保护、事务和授权流程         |
| [cloudbase.ts](../scripts/database/cloudbase.ts)                | 官方 SDK 适配与外部返回值校验          |
| [安全规则说明](security-rules.md)                               | 部署和真实客户端验收方法               |

集合：`users`、`schools`、`grades`、`classes`、`class_memberships`、`audio_programs`、`play_progress`、`favorites`、`letters`、`reports`、`admin_logs`、`system_configs`、`notifications`。

`users.openid`、`play_progress(userId,audioId)`、`favorites(userId,audioId)` 为唯一索引；班级关系额外以 `(userId,classId)` 唯一。管理员查询使用 `role + adminSchoolId`，自选的 `currentSchoolId` 不授予管理权。完整字段顺序、方向与名称以 manifest 为准。

## 2. 离线预览

安装根依赖后，在仓库根目录执行：

```bash
npm run db:init
npm run db:bootstrap-admin
```

两个命令默认 `dry-run`；支持显式 `--dry-run`，不读取凭据、不创建 SDK 连接、不请求云环境、不造用户。输出展示计划。只有显式传入 `--apply` 才会进入云端流程。仅提供 `--env` 仍为预览。

## 3. 开发环境配置

实际配置放在被 Git 忽略的 `config/environments.local.json`，格式沿用[开发指引](DEVELOPMENT.md)：

```json
{
  "dev": { "envId": "填写实际开发环境ID" },
  "test": { "envId": "" },
  "prod": { "envId": "" }
}
```

以上为不可直接执行的说明值。`dev.envId` 必须与命令的 `--env` 一致，且不得等于 test/prod 的环境 ID。必须设置 `SHIXUE_ENV=dev`；test/prod 均被脚本拒绝，不按环境名称是否含 dev 来猜测用途。使用开发环境相连的真实 AppID；默认读本地 `project.config.json` 的 `appid`，也可通过 `SHIXUE_APP_ID` 注入。

SDK 凭据由本机受控环境提供：`TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`；临时凭据额外提供 `TENCENTCLOUD_SESSIONTOKEN`，区域可用 `TENCENTCLOUD_REGION`。不要把凭据或真实 OpenID 放进 JSON、源码、提交、聊天或带明文参数的命令。脚本不自动借用默认环境或自行寻找其他账号的凭据。

## 4. 真实初始化

仅在目标环境、权限及 AppID 已确认后执行：

```bash
# SHIXUE_DEV_ENV_ID 由操作者设为已确认的实际开发环境 ID。
SHIXUE_ENV=dev npm run db:init -- --apply --env "$SHIXUE_DEV_ENV_ID"
```

执行顺序：

1. 将云存储设为拒绝客户端读写并回读规则。
2. 列出集合，只创建缺少的集合；每个集合立即设置默认拒绝规则并回读。
3. 比较索引字段、方向和唯一性。等价索引不重复建，同名不同定义时失败，绝不自动删除或重建已有索引。
4. 创建缺少索引并回读确认后，才进入种子事务。
5. 通过确定性 ID 查存在性，只写不存在的种子。已有配置、组织、业务数据和用户角色全部保留；不自动升级旧配置字段。

初始化使用官方 `createCollection` 与规则 API 分步执行，平台不提供本脚本使用的原子“创建集合并设规则”接口。因此应在云函数和客户端业务流开放前完成；中途失败时不写种子，但已创建集合或已收紧规则仍可能保留。修复原因后可重跑；不要把失败解释为整体回滚。存储规则传播或索引尚未就绪会令脚本失败，待平台完成后重新执行，禁止手动放宽规则来跳过。

种子为一所明确标注“虚构”的测试学校，不含真实学生、家庭信息或用户。`system_configs/app:global` 使用 `key=app`，配置放入 `value`，值引用 `shared/domain.ts` 的 `DEFAULT_SYSTEM_CONFIG`；服务端时间标记由 SDK 生成。业务配置和种子不包含角色授权。

成功后至少再执行一次同命令，新增集合 / 索引 / 种子计数应均为 0；随后按[安全规则验收](security-rules.md#3-真实开发环境验收)验证客户端和唯一索引。脚本输出仅含计数、环境指纹和状态，不将内部错误原文、OpenID 或凭据打印到终端。

## 5. 首个超级管理员

顺序：真实账号在开发环境调用 `authApi.login` → 从受保护的服务端 `users` 记录确认可信 OpenID → 由操作者设置环境变量 `SHIXUE_BOOTSTRAP_OPENID` → 执行受控命令。脚本不能用来创建测试用户，也没有小程序端 bootstrap action。

```bash
SHIXUE_ENV=dev npm run db:bootstrap-admin -- --apply --env "$SHIXUE_DEV_ENV_ID"
```

授权保护：

- OpenID 必须恰好匹配一个既有用户；事务内重读并验证相同 OpenID、active 状态、未删除以及原角色为 user。
- 先检查是否已有任何超级管理员；已存在则不能继续创建“首位”超管。
- 使用固定 `admin_logs/bootstrap:first-super-admin` 回执作为事务并发保护。角色更新、永久回执及脱敏审计同时提交，任何一项失败全部回滚。
- 同一已授权用户重复执行返回 `already-granted`，保留原始审计；回执存在后换账号被拒绝。即使后来撤销首位超管，脚本也不能重新提权。
- 不修改当前所选学校和班级；系统操作审计的 `operatorId/operatorOpenid` 为 `system:bootstrap` 标记，不保存目标用户原始 OpenID。回执不得物理删除或改写以“重置”授权。
- 函数外的 `where` 查询只用于查重与定位；事务内部仅用 SDK 支持的 `doc` 操作。并发脚本以永久回执冲突序列化。初始化期间不要从控制台或其他运维工具并行改角色；平台管理员直接改数据的权力不受应用脚本约束。

授权后从同一真实账号重新调用服务端接口，验证 role、管理边界及审计持久化；单元测试只证明本地分支和事务编排。正式环境初始化另按发布流程实现，本脚本始终拒绝。

## 6. 检查与已知边界

本地命令：`npx vitest run tests/database`、`npm run lint`、`npm run typecheck`、两个 dry-run 命令。测试覆盖双次初始化、保留既有数据、索引冲突、环境拒绝、无用户 / 禁用用户拒绝、首次授权幂等、并发候选只成功一个、日志失败回滚、撤权不重授和 SDK 返回值校验。

暂未执行 `--apply`；缺少可用开发云环境时 TASK-102 保持部分完成。云端真实规则拒绝、唯一索引冲突、SDK 在所选环境的返回形态、首次微信登录后的授权和网络错误回滚，必须另留实测证据。当前默认拒绝也会阻止音频 / 图片直传；后续 TASK-601 在上传功能验收前实现最小授权。

## 7. SDK 与官方核验

2026-09-15 核实并锁定根开发依赖 `@cloudbase/manager-node@5.8.7`、`@cloudbase/node-sdk@3.18.3`。检查 npm 发布包类型和实现；node-sdk 的数据库依赖为 `@cloudbase/database@1.4.3`。Node 脚本使用 CommonJS SDK 的默认导入，已在本机 ESM / tsx 路径执行 dry-run。

- [管理 SDK 初始化](https://docs.cloudbase.net/api-reference/manager/node/introduction)：指定环境与管理员凭据。
- [集合与索引管理](https://docs.cloudbase.net/api-reference/manager/node/database)：`createCollection`、`listCollections`、`describeCollection`、`updateCollection`。同名创建可能重建索引，因此本脚本先比较再创建。
- [安全规则 API](https://docs.cloudbase.net/api-reference/manager/node/rule)：`ModifySafeRule`、`DescribeSafeRule` 与存储规则接口。
- [微信环境查询规则的 AppID 参数](https://cloud.tencent.com/document/api/876/128118)：传入 `WxAppId`。
- [CloudBase 事务](https://docs.cloudbase.net/database/transaction)：服务端事务、仅 doc 操作、冲突与回滚。
- [管理 SDK 官方存储实现](https://github.com/TencentCloudBase/cloudbase-manager-node/blob/master/src/storage/index.ts)：锁定版本的 `setStorageAcl('CUSTOM', rule)` 与 `getStorageAcl({withRule:true})` 已对照发布包。

SDK 类型和官方 API 文档核验不等于真实环境调用成功。
