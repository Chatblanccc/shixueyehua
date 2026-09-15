# 依赖安全审计记录

核验日期：2026-09-15。范围：根依赖树、小程序独立依赖树、`config/cloud-runtime/` 运行清单及在仓库外重新安装的运行依赖。已实施定向依赖补丁并执行本地兼容回归；**没有部署云函数，没有连接真实云环境**。

## 1. 修复前后结果

| 范围与命令                                                   | 修复前 moderate / high / critical | 修复后 moderate / high / critical | 当前退出码 |
| ------------------------------------------------------------ | --------------------------------: | --------------------------------: | ---------: |
| 根 `npm audit --json`                                        |                        19 / 6 / 7 |                    **17 / 0 / 0** |          1 |
| 根 `npm audit --omit=dev --json`                             |                         1 / 5 / 0 |                     **0 / 0 / 0** |          0 |
| 仓库外 `npm ci --omit=dev --ignore-scripts` 后的运行依赖审计 |                        未单独记录 |                     **0 / 0 / 0** |          0 |
| `miniprogram/` 内 `npm audit --json`                         |                        未单独记录 |                     **0 / 0 / 0** |          0 |

数量是 npm 汇总的受影响**包条目**，含上游连带标记，不是独立漏洞或攻击次数。生产依赖当前未检出已知告警；整个开发依赖树仍有 17 个 moderate 条目，不能表述为“全部依赖审计通过”。这也不代表已完成云端安全验收。

小程序审计依据其自身 `package-lock.json`（4 个生产依赖包），未修改小程序依赖；根生产包审计不能代替这项客户端检查。

## 2. 已实施的生产依赖修复

保留 `wx-server-sdk@4.0.2` 及其 `@cloudbase/node-sdk@3.17.2`，根本地 SDK 仍为 `@cloudbase/node-sdk@3.18.3`。根与云函数运行清单采用相同的生产补丁规则。

| 实际依赖位置                               | 原版本 → 当前版本 / 实现                                                           | 兼容处理                                                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@cloudbase/node-sdk → axios`              | `0.27.2 → 0.33.0`                                                                  | 仅对该 SDK 下的 axios 定向覆盖；检查 SDK 请求客户端的 JSON 请求、错误响应及取消行为。                                                                                                     |
| `@cloudbase/database@1.4.3 → lodash.unset` | `4.5.2 → 4.18.0`                                                                   | 使用已发布修复版；检查正常删除路径及原型属性保护。[公告](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg)                                                                               |
| `@cloudbase/database@1.4.3 → lodash.set`   | `4.3.2 →` 本地兼容包 `@shixue/lodash-set-safe@1.0.1`，内部调用 `lodash@4.18.1/set` | 原独立包没有修复版；适配器保留可直接调用的 CommonJS 导出和数据库实时适配器所需的 `.default` 导出，不把完整 lodash 对象冒充函数。[公告](https://github.com/advisories/GHSA-p6mc-m468-83gw) |

补丁源码在 [vendor/lodash-set-safe](../vendor/lodash-set-safe/README.md)。它调用维护中的官方实现，没有复制旧漏洞代码后仅修改包名或版本。发布制品为 `config/cloud-runtime/vendor/shixue-lodash-set-safe-1.0.1.tgz`，由锁文件的完整性校验约束。

根清单通过直接文件依赖与 `overrides` 中的 `$lodash.set` 将数据库的旧依赖指向该兼容包。云函数清单使用其自身目录下的 `vendor/` 相对路径，所以**每个部署包都必须包含运行清单、锁文件和对应 vendor 制品**；只复制 package.json 会导致独立安装失败。构建与 `check:cloud` 的实际部署包核验由工程脚本落实。

## 3. 已实施的本地管理与自动化修复

这些补丁仅在根开发依赖树中，不进入云函数运行清单。

| 实际依赖位置                          | 已采用修复                                                                                                 | 本地兼容证据                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manager-node → toolbox → decompress` | 原 `decompress@4.2.1` 改为本地 CommonJS Promise 适配器，动态加载维护方推荐的 `@xhmikosr/decompress@11.1.4` | 通过 toolbox 实际依赖解析进行 TAR 解包、过滤及 `../` 越界拒绝测试；适配器源码见 [decompress-safe](../vendor/decompress-safe/README.md)。[维护方公告](https://github.com/advisories/GHSA-mp2f-45pm-3cg9)                            |
| `cos-nodejs-sdk-v5 → fast-xml-parser` | `4.2.5 → 5.11.1`                                                                                           | 已检查 COS 的 XMLParser/XMLBuilder 调用；实际 COS 工具的多段上传 XML 往返、中文和特殊字符测试通过。这是经专项验证的大版本覆盖，其他 XML 行为仍需真实存储联调。[XMLBuilder 公告](https://github.com/advisories/GHSA-gh4j-gqv2-49f6) |
| `request → form-data / qs`            | 分别锁至 `2.5.6 / 6.16.0`                                                                                  | 通过实际 request 向本机服务器发送 multipart，验证边界、正文及文件名。[form-data 公告](https://github.com/advisories/GHSA-fjxv-7rqg-78g4)                                                                                           |
| `@jimp/core → mkdirp`                 | `0.5.1 → 0.5.6`，带入修复后的 minimist                                                                     | 实际 Jimp 写入多层新目录的 JPEG 成功。[minimist 公告](https://github.com/advisories/GHSA-xvch-5gv4-984h)                                                                                                                           |
| `@jimp/jpeg → jpeg-js`                | `0.3.7 → 0.4.4`                                                                                            | 实际 Jimp JPEG 编码、解码成功。                                                                                                                                                                                                    |

解包适配器的 tarball 位于根 `vendor/tarballs/`，没有混入云函数的 `config/cloud-runtime/vendor/`。维护中的解包库要求 Node ≥ 20；本项目验证版本为 `.nvmrc` 指定的 **Node 24.21.0**。本轮未用 `npm audit fix --force`，未降级 CloudBase SDK，也未整体替换 Jimp 或微信自动化工具。

## 4. 尚未消除的开发依赖告警

以下 17 个包条目均来自开发依赖树：`@cloudbase/cloud-api`、`@cloudbase/manager-node`、`@cloudbase/toolbox`、`@jimp/core`、`@jimp/custom`、`ajv`、`ajv-formats`、`conf`、`cos-nodejs-sdk-v5`、`decode-uri-component`、`jimp`、`miniprogram-automator`、`phin`、`query-string`、`request`、`tough-cookie`、`uuid`。其中有 6 类叶子包公告，其余含连带标记。

| 剩余路径 / 包                                                     | 已确认范围与处置边界                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manager-node → cos-nodejs-sdk-v5 → request@2.88.2`               | 旧 request 仍有 SSRF 公告且没有原包修复版。multipart 补丁没有修复整个 HTTP 库；后续应随官方 COS/管理 SDK 替换网络实现，或单独验证等价传输适配器。不可把任意外部 URL 交给此管理链。[公告](https://github.com/advisories/GHSA-p8p7-x288-28g6)                                       |
| `request → tough-cookie@2.5.0`                                    | 仍受原型污染公告影响，修复版至少为 4.1.3；目前没有验证跨大版本 cookie-jar 兼容性，因此未强制覆盖。[公告](https://github.com/advisories/GHSA-72xf-g2v4-qvf3)                                                                                                                       |
| `request → uuid@3.4.0`；`manager-node → uuid@9.0.1`               | 已读到的 request 和 manager 源码调用 v4；公告针对带自定义缓冲区的 v3/v5/v6。此源码检查限制了当前已知调用范围，但不等于对 SDK 全部动态路径的完整证明。直接覆盖至 11.1.1+ 会破坏旧 `require('uuid/v4')` 用法，需专门迁移。[公告](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| `manager-node → conf / ajv-formats → ajv@7.2.4`                   | 公告针对启用 `$data` 的模式。已安装 conf 构造 AJV 时仅设置 `allErrors`、`useDefaults`，未开启 `$data`；仍保留审计条目，未来更新 conf/AJV 时需验证配置持久化与模式行为。[公告](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6)                                                  |
| `manager-node → query-string@6.14.1 → decode-uri-component@0.2.2` | 畸形百分号编码可造成拒绝服务；尚未验证 query-string 的兼容替换。本地工具不接收任意来源查询文本，真实管理流程前需检查输入来源并更新或替换解码实现。[公告](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)                                                                       |
| `automator → jimp → @jimp/core → phin@2.9.3`                      | 远程图片 URL 请求使用 phin，存在重定向后敏感请求头转发问题。当前回归使用本地图片，不覆盖远程图片加载；升级 phin 需验证旧 Jimp 的回调接口，不做未验证的大版本覆盖。[公告](https://github.com/advisories/GHSA-x565-32qp-m3vf)                                                       |

本地管理和自动化可以继续处理本项目可信输入；剩余项需要在对应管理、远程素材或自动化流程投入真实使用前复核。它们不随云函数发布，但不能因为是开发依赖就标记为无风险。进入真实部署前，须重新执行审计并记录这些剩余项的处置结果。

## 5. 验证证据与未验证边界

- **Node 24.21.0 下 7 项专项测试通过**：直接运行 `node node_modules/vitest/vitest.mjs run tests/dependencies/sdk-compatibility.test.ts`，没有触发 prepare / build。生产 node-sdk 3.17.2 和本地 3.18.3 分别覆盖属性路径、数据库接口与 HTTP 行为；另含一项本地管理/图片/解包/上传兼容测试。
- **数据库使用实际安装 SDK**：覆盖 add、query、update 的序列化及事务提交、异常回滚；仅以本地替身替换传输层。路径测试检查嵌套/数组正常行为、`__proto__` / `constructor.prototype` 攻击路径，以及 `.default` 兼容。
- **HTTP 使用实际 SDK 请求客户端**：只连接 `127.0.0.1` 临时服务器，验证 JSON 正文、403 错误及取消。管理 request 的 multipart 也只连接本机。
- **仓库外重新安装**：复制运行清单、锁文件、vendor 后执行 `npm ci --omit=dev --ignore-scripts`；独立安装成功，3 个生产专项（路径、数据库、HTTP）通过，生产审计为 0。该检查避免只验证根目录提升安装后碰巧可用的依赖树。
- **专项 lint 通过**：`eslint tests/dependencies vendor/lodash-set-safe/index.cjs vendor/decompress-safe/index.cjs`。测试与夹具见 [tests/dependencies](../tests/dependencies/sdk-compatibility.test.ts)。其他模块、完整构建、模拟器结果由各自验收记录报告，本报告不替代它们。

这些证据确认了补丁的本地安装、关键 API 与部分安全回归。**真实 CloudBase 签名认证、可信 OpenID 上下文、数据库/事务服务、COS 上传和开发云环境仍待正式 AppID/环境后联调**；未把本地替身、回环 HTTP 或依赖审计为 0 当作真实云端验收完成。解包测试也没有穷尽所有压缩格式和平台。
