# 两端共享契约（TASK-100）

- `domain.ts`：13 个集合的领域模型；数据库时间使用 `Date`；当前用户 DTO 使用 ISO 时间并移除 OpenID。
- `errors.ts`：`ApiResult<T>` 判别联合、统一错误码和固定中文文案。
- `validate.ts`：对 `unknown` 响应进行运行时校验，以白名单重建 `UserProfile`，并检查 onboarding 步骤与字段一致。
- `index.ts`：唯一导出入口。这里不引用 SDK、Node 模块或环境变量。

`login` 和 `getProfile` 都返回 `LoginResult`，其中 `onboardingStep` 为 `identity | class | ready`。角色与账号状态始终以云端存储为准；DTO 中的角色仅用于界面状态，不能成为服务端授权凭据。

小程序通过 `npm run build:shared` 生成根内的 `miniprogram/generated/shared/`；不要手工修改生成物或从客户端运行时代码直接引用根目录的 `shared/`。服务端与测试直接引用这里的源码。
