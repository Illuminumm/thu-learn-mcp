# 架构与上游适配

## 分层

```text
MCP stdio → Zod 工具 → LearnService → LearnApi / ThuLearnAdapter → thu-learn-lib
                                           ↓
                            AuthenticationManager → SchoolHttp / CookieJar
```

`src/domain` 定义独立模型与错误；`service` 负责筛选、分页和 DDL 聚合；`adapter` 转换上游类型并缓存查询；`auth` 管理人工认证与会话；`infra` 实现受限网络、安全存储和下载；`mcp` 处理协议。认证与数据访问接口可 Mock，业务层不依赖 MCP。

HTTP 请求串行限流，网络/超时/5xx 最多额外重试两次，429 立即停止。重定向逐跳限制在 Learn HTTPS 域。单课程失败返回错误；跨课程部分失败标记 `complete=false`；认证失败不作为局部 warning 隐藏。stdout 仅写协议，原始错误和认证信息不进入日志。

## 核实过的上游接口

2026-10-11 调研以实际安装的 npm 包为准：

| 上游                                                                         | 版本 / 源码 commit                                               | 用途                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------- |
| [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib)                 | 4.2.6 / `07fac46a3cee98fc88cb76faf4344ea67697b274`               | 认证、课程、作业、公告和课件解析 |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | server/client 2.3.1 / `b022522089a0c8b632595c6e7b536453945ed5a9` | 官方 v2 stdio Server/Client 示例 |
| [CoLearner-MCP](https://github.com/JamesCai23/CoLearner-MCP)                 | `0bd1a224a7c54c5450dc229574b53c8f6ec00fc7`                       | 参考工具分工；未复制其代码       |

- `getCurrentSemester()`、`getCourseList(semesterID, CourseType.STUDENT)`：学期与学生课程。
- `getHomeworkList(courseID)`：合并未交、已交未批、已批列表并获取 HTML 详情/附件。详情方法为 private，`get_assignment` 用列表结果按 ID 查找；学生模型没有发布时间。
- `getNotificationList(courseID)`：合并有效与过期公告；读取可能更新学校已读统计。
- `getFileList(courseID)`：分类、文件 ID、类型、大小、下载地址，默认上限 200。其他列表也受上游默认分页约束。
- npm 4.2.6 没有 Git HEAD 中公开的 `fetchWithToken`；下载使用已公开的 `getCSRFToken()`、`addCSRFTokenToUrl()` 和同一个请求层。`ApiError.extra` 可能包含原始数据，不能输出。

## 认证与补丁

原版 4.2.6 的 Cookie jar 没有公开导入/导出接口。`login()` 优先尝试已有会话，再调用凭据提供器；无密码登录仍可能依赖设备身份或 fingerprint。项目选择让用户在独立 Playwright 窗口自行认证，浏览器不参与日常数据查询。

[兼容补丁](../patches/thu-learn-lib@4.2.6.patch) 只给 `HelperConfig` 增加 `fetch?: Fetch` 并在构造器注入请求实现，同时更新声明；不修改业务 API、读取私有字段或全局替换 fetch。导出浏览器 Cookie 后仅保留适用于 Learn 的项，保留 path/secure/expiry 等属性，将父域收窄到 Learn。真实 helper 的 `login()` 和当前学期请求通过后才保存会话，不读取密码、localStorage 或设备指纹。

Windows 使用 DPAPI 和私有 ACL，POSIX 使用 0700/0600 权限。请求可持久化轮换后的 Cookie；账号变化后应重启客户端，多个进程不合并会话更新。已在 Windows 真实账户验证该流程，验证边界见 [README](../README.md#验证与开发)。

## 维护要点

- 上游用无时区字符串构造 Date，生产入口必须先设置 `TZ=Asia/Shanghai` 再加载库；测试覆盖不同父进程时区。
- 升级时检查实际 npm 安装包与声明，而非只看同版本 Git HEAD。保持补丁 LF 换行及锁文件 hash；正式上游支持同等接口后再移除补丁。
- 当前 TypeScript 6.0.3 满足 typescript-eslint peer 范围。sm-crypto 固定为 0.5.7，修复 [GHSA-vh45-f885-3848](https://github.com/advisories/GHSA-vh45-f885-3848)；项目不使用密码加密登录路径。
- 依赖升级运行 `pnpm install --frozen-lockfile`、`pnpm check` 和 `pnpm audit --prod`，涉及认证/解析时复查合约测试。CI 不配置学校凭据。
- 第一版提供源码安装，暂不发布 npm；发布前需解决补丁随包分发并验证独立安装。正式版本说明使用 GitHub Releases。
