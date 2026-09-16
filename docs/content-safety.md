# TASK-600 内容安全前置模块

2026-09-16：适配层、加密回调、事务结果绑定和图片检查协调模块已实现；图文家书已接入运行时提交前检查及上传归属解析。**TASK-600 真实平台验收仍未完成**，没有真实平台调用或审核结果，不能将本地模块通过视作上线验收。

## 本轮实现

- `cloudfunctions/_shared/content-safety.ts`：文本/图片检查端口，严格解析未知响应，统一 `pass/review/reject` 与 `complete/pending/unavailable`，返回有限标签和请求编号供服务端保存。
- `cloudfunctions/_shared/wechat-content-safety.ts`：只在服务端调用官方 SDK，兼容其函数 Proxy；SDK 动态类型先收窄为 unknown，不引入 any。
- 文本调用固定 version=2、scene=3，OpenID 必须来自已鉴权用户。3000 字正文按 Unicode 码点分为最多 2400 字的片段，相邻重叠 100 字，每段带标题；聚合取最严格结果，不把末尾未检查内容视为通过。分段不能完全保留长文语义，因此内容检查仍不能代替人工审核。
- 整次文本检查默认最多等待 8 秒，超时/SDK 异常/非法返回均是 unavailable；迟到结果不会继续触发后续片段。SDK 已发出的网络请求不保证被取消，不做自动重复请求。
- 图片仅接收云文件 ID，经服务端归属/实际文件校验适配器取得 HTTPS URL；不接受客户端任意 URL。缺适配器时拒绝放行。异步任务编号仅表示 pending，不能当作 pass。
- `assertSafetyQueueAdmission` 默认阻止故障及待检查项，拒绝项始终拦截；显式的服务端 manual_review 策略只允许故障内容进入人工复核队列，不授予公开资格。公开仍需安全检查完成、管理员批准及配置/范围/状态校验。
- `publicSafetyFeedback` 仅返回通用提示，移除内部标签、trace ID、原文、关键词、URL、异常与凭据。内部结果不能直接作为作者/公开接口 DTO。
- `miniprogram/services/local-content-safety.ts` 提供本地 pass/review/reject/pending/unavailable 演示反馈；严格沿用 dev、无云、显式启用条件，全部标注“非微信审核”。这是供后续页面接入的体验模块，本轮未新增用户页面或假提交入口。
- 运行时已注入适配器。构建仅为 `letterApi` 声明两个内容安全 OpenAPI 权限，其他五个领域不增加授权；独立云包检查会验证权限清单。

## 必须继续完成的接入

以下清单保留前置阶段记录；当前图文上传与投稿已接线，最新边界见本文末尾及 [家书记录](letters.md)。真实平台项目均仍待验。

1. TASK-400 文字流程已保存草稿并接入检查，检查后事务内复验身份、正文哈希及版本；图片仍需接线，不能只凭回调结果跳过最后的业务事务复验。
2. TASK-401/601 实现图片上传归属、实际 MIME/大小、不可覆盖文件和足够生命周期的临时 URL。当前 runtime 故意没有图片解析器，不会信任裸 fileId。
3. 回调验签/解密、HTTP 入口及事务结果绑定已实现，见下节。图片检查协调层可以原子登记任务及回执、读取回调结果，尚未接到运行时投稿入口。需配置并验证真实消息推送和 HTTP 映射。
4. 家书提交、人工审核与公开列表使用不同权限条件；不可仅凭“允许进入复核队列”公开。现有 letterApi 支持文字草稿与提交，图片禁用；公开列表和管理员审核仍未实现。
5. 正式 AppID 就绪后验证接口权限、真实文本结果、私有图片下载、回调、超时与账号限制。当前仅使用本地可控替身，未向平台发送任何用户内容。

## 验证

测试：`tests/backend/content-safety.test.ts`、`tests/client/local-content-safety.test.ts`。覆盖通过、复核、拒绝、超时、迟到结果、分段尾部风险、非法响应、SDK Proxy、图片待检查/归属失败、最小权限、结果脱敏与云/本地隔离。

运行 `npm run verify`、`npm run format:check`、`npm run check:cloud`。实际执行结果记录在 implementation-plan.md；本轮不改变页面，无需以重复模拟器检查充当新功能验收。

## 官方依据

2026-09-16 核验当前官方页面及本地锁定 SDK 源码（4.0.2）。旧 OpenApiDoc 地址已返回目录，以下为本次读取到的现行接口页：

- [文本内容安全识别](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html)：version=2、单次上限 2500 字，建议值为 pass/review/risky；risky 映射为本项目 reject。
- [多媒体内容安全识别](https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_mediacheckasync.html)：media_type=2、异步 trace_id 与结果推送，不能以受理回执判定通过。

本地 SDK 会将响应转为驼峰字段；解析器同时支持官方 snake_case 和 SDK camelCase，遇到两种同义字段冲突则拒绝。

## 继续推进：可信图片回调与持久化

### 已实现代码

- `safety-callback.ts`：GET 挑战验证；POST 必须为安全模式 JSON，验证包含密文的 msg_signature，再进行 AES-256-CBC 解密、32 字节 PKCS#7 填充检查、UTF-8/长度/AppID 校验。签名采用固定长度恒时比较；请求时间戳允许前后 5 分钟。明文、兼容模式、XML、伪造来源头和不匹配 AppID 均不被接受。
- `safety-jobs.ts`：只接受已登记任务，绑定 appid、trace ID、作者、家书、revision、contentHash、文件及有效期。事务内重新读取草稿。删除/已发布/修订/移除图片/过期后忽略迟到结果；重复结果不重复写，冲突结果拒绝覆盖。回调只写检查结果，绝不改变家书审核或公开状态。
- `safety-jobs-db.ts`：真实 CloudBase 事务适配、严格记录解析、插入/更新/事务提交回执检查。`register` 使用 appid+trace ID 的确定性文档 ID，拒绝任务改绑、延长有效期或预先附带“通过”结果。调用方必须是已鉴权的提交代码，不提供客户端注册 action。
- `safety-http.ts`、`letterApi/index.ts`、`runtime.ts`：在原 letterApi 函数接入 HTTP 回调，不增加独立后端。业务 action 仍走原鉴权。携带 httpMethod 的调用也必须通过同一签名校验，不能因来自小程序或带来源头而跳过。
- 初始化清单新增 `media_safety_jobs`，appid+trace ID 唯一索引及版本/过期索引；沿用数据库默认拒绝规则。未执行真实初始化。

### 部署前置（本轮未执行）

仅服务端配置 `SHIXUE_CALLBACK_APP_ID`、`SHIXUE_CALLBACK_TOKEN`、`SHIXUE_CALLBACK_AES_KEY`，与微信后台消息推送配置一致；没有默认密钥，不写入项目配置或客户端。缺配置返回 503，不初始化云数据库，也不会变成本地演示结果。

需将 CloudBase HTTP 访问映射到 letterApi，并核验实际事件字段：`httpMethod`、`queryStringParameters`、原始字符串 `body`。本版明确拒绝 `isBase64Encoded=true`，不猜测网关解码方式；如实际网关只提供该编码，先补适配和测试。未开通公网访问、部署回调 URL 或更改平台设置。官方原生云函数消息推送说明目前仅声明客服消息，不能假设媒体审核事件会自动进入云函数；采用已验签的 HTTP 接入路线，真实可用性待目标环境验证。

早于任务登记的回调返回 503，允许平台重试，不能先回 success 丢失结果；事务失败同样返回 503。重试耗尽/长期 pending 的任务需由后续提交状态与超时恢复流程处理。本模块不持久化完整密文、原文或内部异常，不物理清理业务任务记录。

### 本地验证与边界

新增 `tests/backend/safety-callback.test.ts` 与 `tests/database/safety-jobs-db.test.ts`。覆盖真实密码算法配合虚构测试密钥、官方 GET 签名示例、非法签名/AppID/事件、重复/并发/冲突回调、版本与图片错配、下载失败、过期、早到回调、存储故障及缺配置。数据库测试使用事务替身，非真实 CloudBase。

本轮无新增用户页面；无云演示仍仅在显式 dev 本地模式下可用，不导入或模拟服务端回调密钥。后续 TASK-400/401 必须把本地业务体验与真实回调分开接入。

协议依据：[微信消息推送官方文档](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html)，2026-09-16 实际读取安全模式、挑战验证、消息加解密和接收方式说明；真实环境联调仍未完成。

## 图片检查提交协调层（已实现，尚未启用到用户入口）

本节为前置阶段记录：最新提交已经通过 runtime 与 letterApi.submit 接入协调层；缺真实回调配置仍拒绝带图提交。

`safety-submission.ts` 接受服务端可信作者、家书版本、内容哈希和不可覆盖图片列表，不提供客户端 action。调用者必须先完成身份和上传归属校验，且在最终提交业务事务内再次验证身份、组织、版本与全部结果；本模块不改变家书状态。

- `media_safety_submissions` 按 AppID、作者、家书、版本、正文哈希和文件 ID 生成确定性 ID。同版本同图片的并发调用共用 60 秒请求租约，不重复触发平台检查；进程中断或检查失败后，后续调用可在租约到期后重试，无后台自动轮询。
- 平台只返回单个合法异步任务号才受理。`safety-submission-db.ts` 在一个事务里插入 `media_safety_jobs` 并更新选中的回执；写入或提交未确认时不返回成功，已有 trace 不允许改绑。
- 再次检查读取已验签回调保存的结果，不把 pending 当作通过。草稿修改、删除、公开或移除图片时拒绝续接；过期未完成任务重新申请，旧任务结果不能覆盖新任务。
- 当前应用策略为结果等待窗口 30 分钟、外部请求租约 60 秒；不是微信平台时限承诺。回调结果必须落在该任务有效期内。相同内容版本的已拒绝结论保留，即使等待窗口已过也不会重新抽取检查结果；有效期过后的通过结果需要重新检查。
- 多图逐项检查并返回全部结果，调用方须使用 `assertSafetyQueueAdmission` 聚合判断。`review` 只能进入人工复核，不能自动公开。内部任务号、标签和结果不能直接用作作者 DTO。
- 新集合沿用初始化脚本默认拒绝规则，只维护索引清单，未在真实环境创建。本轮未开放图片上传、本地模拟图片或运行时协调入口，既有文字家书体验保持不变。

新增 `tests/backend/safety-submission.test.ts` 使用真实协调层、CloudBase 适配器及回调结果绑定代码，数据库和平台响应为本地替身。覆盖并发、两图等待、拒绝保留、旧版本/旧任务失效、过期恢复、直接伪造通过、任务号冲突、存储事务失败和记录解析。验收结果见 [实施计划](implementation-plan.md)。

## 图文投稿接线（当前）

`letterApi/images.ts` 把上传许可与作者私有草稿绑定；文件只在校验实际字节/大小/MIME 后获得最终 ID。`runtime.ts` 的 resolveImage 重新读取可信作者、草稿与已确认且已引用的图片，签发短期下载地址。客户端不能传 URL 或安全结论。

`letterApi.submit` 先检查文字，再读取/申请所有图片检查，只有全部完成且无拒绝项时才进入人工待审。最后事务重新验证用户、组织、稿件版本、哈希、图片归属和当前图片配置，保存脱敏前的内部聚合摘要。检查 pending/unavailable 时保留草稿；回调本身不改变审核状态。编辑器重试未改稿件不会增加 revision。

云存储默认拒绝规则保持不变。真实环境仍须验证限时 PUT 授权、不可覆盖封存、临时地址生命周期、函数超时配置、消息接收权限/回调以及 SDK 事务行为。每稿当前限制 6 个未清理票据；按用户的上传速率与无人返回时的定时孤儿文件清理仍须在生产开放前补齐。本地体验不发起这些云请求、不伪造微信回调。
