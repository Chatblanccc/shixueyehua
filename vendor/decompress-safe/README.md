# 本地解包适配

`decompress@4.2.1` 原包未维护、没有目录穿越修复版本。维护方建议迁移到 `@xhmikosr/decompress` 的修复版；此包锁定 `11.1.4`。

CloudBase Toolbox 以 CommonJS 导入，维护版本使用 ESM，因此仅保留原 `(input, output, options) => Promise<entries>` 调用形态并桥接动态导入。全部解包由维护方实现执行，不复制旧的漏洞代码或屏蔽安全错误。

该包仅用于本地管理工具，不列入云函数生产依赖。普通文件、tar 解包、过滤选项以及越界目录拒绝通过 `tests/dependencies/` 验证；其他平台与历史格式没有穷尽联调。
