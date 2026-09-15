# lodash.set 兼容适配

上游 `lodash.set@4.3.2` 没有修复原型污染的发布版本。本包保留 `(object, path, value)` 的 CommonJS 函数签名，实际调用官方维护中的 `lodash@4.18.1` 的 `set` 子模块，同时为 CloudBase 的编译后默认导入提供 `.default`。

没有复制、改名或仅抬高旧的脆弱实现版本。通过 npm override 将 SDK 的 `lodash.set` 解析到此适配包；锁文件进一步固定实际 lodash 版本与完整性值。

源文件在 `vendor/lodash-set-safe/`；使用 `npm pack ./vendor/lodash-set-safe --pack-destination ./config/cloud-runtime/vendor` 生成版本化 tarball。云函数分发必须携带该 vendor 目录，不能只复制依赖清单。

验证见 `tests/dependencies/`：正常嵌套属性、数组路径、返回值、默认导出，以及 `__proto__`、constructor/prototype 路径攻击；还验证真实 SDK 的离线序列化和事务编排。测试不证明云环境联调完成。
