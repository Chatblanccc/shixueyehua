# 云函数基础（TASK-101 / TASK-103）

六个领域入口使用 `_shared/handler.ts` 的统一解析、鉴权、错误与请求日志。当前真实持久化动作只有 `authApi.login` 与 `authApi.getProfile`；`authApi.health` 仅用于开发/测试环境的数据库连通检查。后续业务动作在完成对应安全检查前，返回 `NOT_IMPLEMENTED`；不返回空列表或模拟写成功。

## 身份与权限

- `runtime.ts` 仅从 `wx-server-sdk.getWXContext()` 读取 OpenID 和当前部署 `ENV`，校验后用该环境初始化 SDK。客户端 payload 无法提供身份、环境或角色。
- `login.ts` 先查询可信 OpenID；不存在时使用确定性 `_id` 和原子 `add` 创建 `role=user`。并发唯一冲突或插入后响应中断时读取已有用户恢复。禁止用 `set` 覆盖角色与用户资料；部署前仍须创建 `openid` 唯一索引。
- `db.ts` 隔离 SDK，数据库返回先按 `unknown` 校验。查出重复 OpenID、畸形记录或不匹配身份时失败关闭。
- 每次管理请求重新读取服务端角色和状态。`admin` 使用 `adminSchoolId`，从不使用自选 `currentSchoolId` 授权；所授权学校必须存在、启用且未删除。`super_admin` 的目标学校也必须验证。
- 后续真实资源操作必须先加载资源，再将其可信学校交给权限检查，不能只验证请求中的学校。现在保留的业务入口不会读写资源。
- `disabled` 用户可登录查看受限状态，但不能执行投稿及管理写操作；`deleted` 或带 `deletedAt` 的用户拒绝登录与操作，不创建替代账号。

## 结果、日志与分页

所有结果带服务端 UUID `requestId`。错误响应只返回固定错误码与文案，控制台日志只保留领域、动作、请求 ID、结果和错误码；不记录 payload、OpenID、SDK 异常或堆栈。

`audit.ts` 提供管理日志落库方法；`before/after` 只接受有限状态字段，不保留家书全文、联系方式、文件地址和令牌。`operatorOpenid` 仅落受保护的审计集合。后续管理写入必须将业务状态与审计写入放入同一事务，或实现可靠且可验证的补偿；本阶段未开放业务管理写入。

`pagination.ts` 使用 HMAC 校验分页游标，包含稳定排序位置与服务端查询范围，拒绝跨查询复用、签名篡改和非法分页大小。签名密钥必须由服务端注入，至少 32 字节，不能在客户端或仓库设默认真实值。当前阶段没有开放业务分页接口。

## 构建和验证边界

根目录 `npm run build:cloud` 生成六个独立部署包。只上传 `dist/cloudfunctions/<name>/`，不直接上传 TypeScript 源码。

`APP_ENV` 是部署配置，由服务端设置为 `dev | test | prod`。health 在缺失、未知或 `prod` 值时拒绝；允许时读取 SDK 当前环境并实际查询 `system_configs` 的全局配置位置，只报告连通状态、环境和检查时间，不返回记录内容。

`tests/backend/` 验证并发登录、越权和跨校、撤权、账号状态、SDK 适配边界、脱敏与游标。测试使用隔离的 repository / SDK 替身，仅证明本地代码行为；不能证明真实微信身份、云数据库索引与权限规则已经部署或通过真机测试。
