# TASK-400 / 401：图文家书与分层页面

2026-09-16。图文草稿、可信上传归属、异步检查提交接口及独立写信页已接线，本地体验复用页面与 service。真实云、消息回调、文件上传与真机验收仍待完成，不能标记上线验收完成。TASK-403 列表筛选、完整状态详情，及审核/公开展示仍待后续开发。

[图片检查协调模块](content-safety.md)已接 runtime 与 submit。图片异步检查期间返回 CONTENT_CHECK_PENDING 并保留草稿；稍后重试时编辑器不会对未修改内容增加版本，因而可续接原检查结果。需要服务端回调配置，否则失败关闭，不回退本地成功。

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
| prepareImage | letterId、revision、fileName、fileSize | 作者可编辑草稿才可申请；仅 JPG/PNG、最大 5MB；每稿最多 6 个未清理上传票据 |
| confirmImage | letterId、ticketId | 读取实际字节、验证类型/大小并写入不可覆盖最终文件，返回 fileId；同票据不重复封存 |
| cancelImage | letterId、ticketId | 仅本人，已被正文引用的图片不能取消 |
| imageUrls | letterId、fileIds | 仅作者确认过的图片；临时预览地址 600 秒 |
| cleanupImages | letterId | 过期且超过上传/验证缓冲后清理；正文仍引用时保留最终文件，其他票据取消并清理 |

`listPublic`、`report`、管理员审核仍未实现。列表暂不提供 TASK-403 的状态筛选或时间排序。

草稿允许空标题/正文；提交标题 2–30 字、正文 20–3000 字，长度按 Unicode 码点校验，明显联系方式/外链阻止提交。先创建空附件草稿，再申请该稿上传票据、确认文件，最后 updateDraft 绑定图片；不接受裸 fileId、他人稿件图片或未确认文件。图片上限按默认值、全局配置、学校覆盖读取，enableLetterImages=false 时禁止添加/提交带图；硬上限 3 张。客户端暂显示默认 3 张，较低学校上限由服务端拦截，配置提示同步仍需完善。

`recipientType`：child / parent / teacher / classmate / future_self / other；`visibility`：private / class / school。选择公开范围不代表立即公开。

版本不匹配报 `LETTER_STATE_CONFLICT`。待审同版本重复提交直接返回既有状态，不重复检查；检查期间编辑、撤回或禁用账号不会让旧结果覆盖新稿。平台检查不可用或未完成时不入队，不回退本地成功。服务端重新读取用户当前 school/grade/class 绑定提交范围，数据库检查摘要不返回客户端。

## 页面与本地体验

“一封家书” Tab 只承担阅读氛围与导航；“我的家书”独立管理稿件；“写一封家书”独立编辑。信纸正文、附件区、展示范围按层次排列，操作固定在底部，错误提示紧邻按钮。尚未提供精选数据时明确空态，不制造已审核内容。

选择图片后实际压缩，再保存到本机或经限时许可 PUT 到云隔离路径；图片绑定后自动保存草稿。未保存编辑按本地/云模式及账号隔离缓存，正文与附件重开可恢复。开发本地待审不调用微信审核、不发布公开家书；选图、压缩、文件保存与预览仍使用原生 API。模拟器的选择器使用包内图片夹具，不能代替用户相册/相机的真机验收。重置清除业务记录和编辑缓存，保存文件的物理回收还需补本机存储管理。

主要文件：

- 共享：`shared/letters.ts`、`errors.ts`、`index.ts`。
- 服务端：`cloudfunctions/letterApi/letters.ts`、`_shared/letter-repository.ts`、`letter-db.ts`、`repository.ts`、`db.ts`、`handler.ts`。
- 图片接入：`letterApi/images.ts`、`_shared/letter-config.ts`、`audio-storage.ts`、`runtime.ts`；图片票据嵌入作者私有 letters 记录，DTO 不返回票据/上传路径。
- 小程序：`services/letter.service.ts`、`local-letters.ts`、`local-repository.ts`、`letter-editor-cache.ts`、`pages/letters/`、`pages/profile/index.ts`。
- 图片与页面拆分：`services/letter-image.service.ts`、`pages/letters/controller.ts`、`pages/write-letter/`、`pages/my-letters/`、`app.json`。
- 数据库：`scripts/database/manifest.ts` 增加本人未删除列表游标索引；实际创建待云环境。
- 测试：`tests/backend/letters.test.ts`、`tests/database/letters-db.test.ts`、`tests/client/local-letters.test.ts`，更新测试仓库与本地兼容用例；`scripts/verify-local-experience.ts` 增加真实页面输入与流转检查，结束恢复数据库和编辑缓存。

本地检查与交付证据统一记录于 [实施计划](implementation-plan.md)。微信开发者工具、替身、真实云与真机是独立证据，不相互替代。
