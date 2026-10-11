# Changelog

## Unreleased — 0.1.0 candidate

- 实现 8 个只读学校 MCP 工具：认证状态、课程、作业列表/详情、公告、课件列表/下载和 DDL 聚合。
- 使用 MCP TypeScript SDK v2 stdio、Zod 结构化输入/输出及独立领域模型。
- 提供浏览器人工认证、跨进程会话复用、Windows DPAPI 与 POSIX 私有权限存储。
- 提供受限网络请求、安全本地下载、有限重试和 Asia/Shanghai 日期规范化。
- 加入模拟合约/协议测试、独立真实验收脚本，以及开源贡献与维护文档。

已完成 Windows 本地自动化测试和真实学校接口抽样。长期 Session、历史学期及其他系统的结果见 [验证记录](docs/verification.md)。GitHub 正式发布前不标记为已发布版本。
