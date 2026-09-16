# TASK-400：文字家书第一轮

2026-09-16。文字草稿与投稿接口已实现，本地体验复用页面和 service。TASK-400 **部分完成**：带图片家书、图片数量配置、上传归属/异步检查接入与真实平台验收仍待完成；TASK-401/403 目前只有基础编辑和本人列表，不代表完整任务验收。

后续前置已推进：[图片检查协调模块](content-safety.md#图片检查提交协调层已实现尚未启用到用户入口)已补并发租约、原子任务登记、回调结果读取与过期恢复。目前仍是未启用的服务端模块，不代表图片已能上传或提交；需先补可信上传归属，再接入本页所述 submit 和本地体验。

## 接口与状态

调用 `letterApi`，业务字段置于 `payload`，不接受客户端作者、角色、学校、审核状态或安全结论。

| action | payload | 当前行为 |
| --- | --- | --- |
| createDraft | requestKey，title/content/recipientType/visibility/imageFileIds（可省略） | 登录且已选有效组织；同作者同 requestKey 同内容返回原记录，不同内容拒绝 |
| updateDraft | letterId、revision，加需修改字段 | 仅作者的 draft/rejected；更新后 draft、版本加一、清除旧安全结论 |
| submit | letterId、revision | 校验正文并调用微信文本检查；事务内重新验身份、内容哈希和版本，再进入 pending |
| withdraw | letterId、revision | 作者 pending/approved → draft；版本加一，旧检查失效 |
| delete | letterId、revision | 作者 draft/rejected/hidden → deleted，设置 deletedAt；重复删除幂等 |
| detail | letterId | 仅本人且未删除；不是公开详情接口 |
| listMine | 可选 cursor | 仅本人、排除软删除、按稳定 ID 升序，每页 20 项，返回 nextCursor |

`listPublic`、`report`、管理员审核仍未实现。列表暂不提供 TASK-403 的状态筛选或时间排序。

草稿允许空标题/正文；提交标题 2–30 字、正文 20–3000 字，长度按 Unicode 码点校验，明显联系方式/外链阻止提交。所有非空 imageFileIds 当前失败关闭，不接受未经归属验证的文件。

`recipientType`：child / parent / teacher / classmate / future_self / other；`visibility`：private / class / school。选择公开范围不代表立即公开。

版本不匹配报 `LETTER_STATE_CONFLICT`。待审同版本重复提交直接返回既有状态，不重复检查；检查期间编辑、撤回或禁用账号不会让旧结果覆盖新稿。平台检查不可用或未完成时不入队，不回退本地成功。服务端重新读取用户当前 school/grade/class 绑定提交范围，数据库检查摘要不返回客户端。

## 页面与本地体验

现有“一封家书” Tab 提供文字表单、草稿保存、提交、本人列表、撤回/软删除和失败反馈。未保存编辑按本地/云模式及账号隔离缓存；本地数据库保留已保存记录，重置体验时清除家书与编辑缓存。开发本地待审不调用微信审核、不发布公开家书，页面明确标注。

主要文件：

- 共享：`shared/letters.ts`、`errors.ts`、`index.ts`。
- 服务端：`cloudfunctions/letterApi/letters.ts`、`_shared/letter-repository.ts`、`letter-db.ts`、`repository.ts`、`db.ts`、`handler.ts`。
- 小程序：`services/letter.service.ts`、`local-letters.ts`、`local-repository.ts`、`letter-editor-cache.ts`、`pages/letters/`、`pages/profile/index.ts`。
- 数据库：`scripts/database/manifest.ts` 增加本人未删除列表游标索引；实际创建待云环境。
- 测试：`tests/backend/letters.test.ts`、`tests/database/letters-db.test.ts`、`tests/client/local-letters.test.ts`，更新测试仓库与本地兼容用例；`scripts/verify-local-experience.ts` 增加真实页面输入与流转检查，结束恢复数据库和编辑缓存。

本地检查与交付证据统一记录于 [实施计划](implementation-plan.md)。微信开发者工具、替身、真实云与真机是独立证据，不相互替代。
