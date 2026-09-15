# 文档总览

本目录维护实学夜话 V0.1 的开发基线与实施资料。**阶段 1 本地验收全部通过，尚未进入阶段 2。** 用户暂无正式 AppID 和关联云环境，已选择先完成本地开发；云端初始化、可信微信登录联调和手机验收仍待进行。

本轮在 Node `24.21.0` 下通过完整质量检查、13 文件 / 124 项测试、格式检查与六个实际云函数包的仓库外安装 / 加载 / 审计。模拟器 12 项检查全部通过，异常为 0。根生产、实际部署包及小程序依赖审计均为 0；根全量依赖仍有 17 项 moderate，high / critical 为 0。各层证据见[测试记录](test-cases.md)、[实施计划](implementation-plan.md)及[依赖审计](dependency-audit.md)。

## 按需要阅读

| 你要做的事             | 阅读入口                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 快速了解项目           | [仓库首页](../README.md) → [产品概览](PRODUCT.md)                                                                                           |
| 确认首期范围和推进顺序 | [功能路线图](ROADMAP.md) → [实施计划](implementation-plan.md)                                                                               |
| 开始编码               | [开发规则](../AGENTS.md) → [PRD](PRD.md) → [开发任务书](CODEX_TASKS.md) → [开发指引](DEVELOPMENT.md)                                        |
| 查选型、权限和数据边界 | [技术栈与架构](TECH_STACK.md) → [开发决策](decisions.md)                                                                                    |
| 查已实现接口           | [云函数接口](cloud-functions.md) → [云函数工程说明](../cloudfunctions/README.md)                                                            |
| 初始化开发数据库       | [数据库与首次授权](database.md) → [安全规则](security-rules.md)                                                                             |
| 做任务验收             | [测试用例与记录](test-cases.md) → [独立复核](acceptance-review.md) → [实施计划](implementation-plan.md) → [任务书](CODEX_TASKS.md)对应 TASK |
| 处理依赖告警           | [依赖审计](dependency-audit.md)                                                                                                             |
| 查看导入来源           | [原始 Word 文档包](../实学夜话_V0.1_完整开发文档包/README.md)                                                                               |

## 各文档维护什么

- `PRD.md`：产品需求和验收基线，不把实现进度写成产品需求。
- `CODEX_TASKS.md`：TASK 编号、依赖、实施要求。保留原编号，便于持续交付。
- `PRODUCT.md` / `ROADMAP.md`：需求摘要与阶段路线，随基线更新。
- `TECH_STACK.md` / `DEVELOPMENT.md`：技术决策、环境要求、已经验证或仍属规划的开发流程。
- `implementation-plan.md`：任务状态与实际证据。每次交付更新，不能仅凭文档存在标记业务完成。
- `decisions.md`：记录基线澄清、平台差异及待确认项，同时把已采纳变更同步到受影响的基线。
- `database.md` / `security-rules.md`：实际脚本、默认拒绝规则、部署与验收边界；脚本 dry-run 不代表云资源已创建。
- `cloud-functions.md` / `test-cases.md`：实际接口与验证记录，明确已实现、未实现和待真实联调范围。
- `acceptance-review.md`：阶段 1 服务端 / 数据库的独立复核、修复、目标测试证据和真实云必验清单。
- `dependency-audit.md`：已实施依赖补丁、审计范围、本地兼容验证与剩余开发依赖处置项。
- 根目录 `AGENTS.md`：对整个仓库生效的开发约束。

产品范围以 PRD 为准，任务细节以任务书为准；两者冲突时先记录并同步修订，避免两份相互矛盾的约定。概览文档不能自行扩大范围。Word 仅保留原始版本，本轮未同步修改 Word。

## 实现资料与后续交付

实现资料与代码同步维护；文件存在不等于对应云端或发布验收已经完成。

| 文档                                         | 对应节点                       | 内容与当前边界                                                     |
| -------------------------------------------- | ------------------------------ | ------------------------------------------------------------------ |
| [database.md](database.md)                   | TASK-102                       | 集合 / 索引、幂等种子、首次超管脚本已实现；云端执行待验证          |
| [cloud-functions.md](cloud-functions.md)     | TASK-101～103 起持续维护       | 实际 action、输入输出、错误码和权限矩阵；真实登录待联调            |
| [security-rules.md](security-rules.md)       | TASK-102；TASK-601 随上传补充  | 默认拒绝文件及部署 / 回读代码已实现；客户端真实拒绝待验证          |
| [test-cases.md](test-cases.md)               | TASK-002 起积累；TASK-603 汇总 | 自动化与人工用例、当前结果、未验证边界                             |
| [dependency-audit.md](dependency-audit.md)   | TASK-002 / 部署前              | 根生产 / 实际部署包 / 小程序审计为 0；根全量仍有 17 项 moderate    |
| [acceptance-review.md](acceptance-review.md) | TASK-100～103                  | 服务端和数据库 3 项缺口已修复，96 项目标测试通过；真实云验证仍待办 |
| `release-checklist.md`（后续创建）           | TASK-604                       | 正式配置、体验版、真机、提交审核与发布记录                         |

阶段 1 本地统一验收入口为 `npm run verify:stage1`；各子命令均已实际验证，运行前需满足[开发指引](DEVELOPMENT.md)中的 Node 和微信开发者工具条件。实现文档中的命令必须与实际脚本一致；示例、mock、云端验证、真机验收和平台发布分别记录。
