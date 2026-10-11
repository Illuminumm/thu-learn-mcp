# GitHub 维护与发布

项目仓库名为 `thu-learn-mcp`。第一版在 GitHub 提供源码安装，不发布 npm 包；`package.json` 中的 `private: true` 不影响开源或 GitHub 可见性，它只阻止误执行 npm 发布。原因是当前运行依赖 pnpm 的本地补丁和配套锁文件，不能把源码仓库安装方式直接等同于可独立消费的 npm 包。

## 提交前

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm audit --prod
git diff --check
git status --short
```

检查待提交文件；`.gitignore` 只影响尚未跟踪的文件。会话、`.env`、本地 `.mcp.json`、浏览器状态、下载文件、HAR、原始真实接口响应都不属于仓库。真实验收报告只公开方法与结果，不公开个人课程统计或文件信息。首次提交前可用 `git diff --cached` 检查实际暂存内容。

建议从 Git 中导出的纯源码目录安装并执行 `pnpm check`，确保没有依赖本机研究目录、已有 dist 或 node_modules。升级补丁时尤其需要确认 LF 换行和锁文件 hash 一致。

## GitHub 设置

- 仓库描述：`Read-only MCP server for Tsinghua Learn: courses, assignments, announcements, files, and deadlines.`
- 建议 topics：`mcp`、`mcp-server`、`tsinghua`、`typescript`、`thu-learn`。
- 启用 Private vulnerability reporting；安全报告按根目录 `SECURITY.md` 处理。
- 建议要求 PR 检查通过后合并 main。仓库提供 Ubuntu/Windows 检查和 Ubuntu 模拟浏览器检查，全部使用虚构数据，不配置学校凭据为 Actions Secret。
- Actions 使用只读仓库权限、固定 commit SHA，并关闭 checkout 凭据持久化。Dependabot 按月提出依赖更新；涉及补丁或学校解析的升级需要人工审查。

## 首次正式 Release

1. 在公开仓库确认 main 的 CI 检查结果。若某个平台失败，不将它标为已验证。
2. 将 `CHANGELOG.md` 的候选条目改为实际版本和日期，并同步 `package.json`、MCP Server/Client 元数据中的版本号。
3. 基于通过检查的 commit 创建对应版本 tag 和 GitHub Release，说明认证方式、支持范围和已知限制。
4. 使用 GitHub 自动生成的源码归档即可，不上传整个工作目录、node_modules、Session、下载课件或浏览器缓存。

未来如要发布 npm，需要单独设计补丁随包分发或等待上游支持请求注入，并验证消费者安装、运行入口和打包文件清单。不要仅删除 `private` 就认为 npm 分发已准备好。
