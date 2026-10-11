# 贡献指南

欢迎提交问题、文档修正和代码改进。讨论功能时优先描述具体使用场景；较大的接口或认证变更请先开 issue，方便确认范围。

## 本地开发

需要 Node.js 24.13+、pnpm 11.17.0 和 Git：

```sh
pnpm install --frozen-lockfile
pnpm check
```

常规测试使用虚构课程和本地模拟 HTTP，不需要学校账号或 Chromium。修改后执行 `pnpm format` 和 `pnpm check`。可选 `pnpm test:browser` 需要先安装 Chromium；页面请求全部在本地拦截。

`pnpm verify:live` 会读取本人的学校账号并下载课件，只在明确需要真实验收时手动执行，不加入 CI。保留本地结果即可，不将课件、截图、Session、HAR 或个人课程列表作为测试 fixture 提交。公开测试数据全部手工构造；错误报告使用固定错误 code 和最小脱敏复现。

## 代码边界

- MCP 层处理 Schema 和协议，业务规则放在 service，学校 API 差异放在 adapter；领域模型不依赖 MCP 或上游类型。
- 保持 TypeScript strict 和显式空值语义，不编造缺失的日期、提交状态等数据。
- 第一版保持学校业务只读，不添加密码型 MCP 参数、自动破解验证码/二次认证或任意 URL 下载工具。
- stdout 仅写 MCP 协议。日志不得包含原始异常、URL 中的认证参数、Cookie 或课程正文。
- 网络请求沿用超时、串行限流、有限重试和固定域限制；下载沿用目录约束及独占创建。
- 修改行为时加入能验证该行为的测试；文档或格式修正不要求额外测试。

架构与上游调研见 [docs/architecture.md](docs/architecture.md)，安全边界见 [SECURITY.md](SECURITY.md)。

## 上游补丁与依赖

`thu-learn-lib` 的 npm 包与同版本 Git HEAD 可能不同。升级前检查实际可安装包中的类型和实现，重新验证认证、HTML 解析与下载合约。当前补丁只增加 fetch 注入，详见 [patches/README.md](patches/README.md)。不要直接编辑 node_modules 后忘记保存补丁。

依赖变更应提交 `package.json`、`pnpm-lock.yaml` 和必要的 `pnpm-workspace.yaml`，执行 `pnpm install --frozen-lockfile`、`pnpm check`、`pnpm audit --prod`。GitHub Actions 固定完整 commit SHA，由 Dependabot 提议更新。

## 提交与 PR

使用描述实际行为的提交信息，一次 PR 聚焦一个问题。说明如何验证、哪些真实环境尚未覆盖，不把计划运行的检查写成已通过。所有测试、文档和贡献按本仓库 [MIT 许可证](LICENSE) 提供；引用或修改第三方代码时保留其署名和许可说明。

请尊重使用者、维护者和学校系统管理员。讨论针对技术问题，不索取他人的学校凭据。维护者发布步骤见 [docs/publishing.md](docs/publishing.md)。
