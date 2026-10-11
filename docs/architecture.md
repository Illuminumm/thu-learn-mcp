# THU Learn MCP 技术设计

调研日期：2026-10-11。先检查 npm 实际发布版本，再核对源码与安装包类型。设计阶段不使用真实学校账户；实现后由用户完成认证，并进行了 [真实接口验收](verification.md)。

## 上游证据

| 项目                                                                         | 本次源码 commit                            | 采用/参考                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib)                 | `07fac46a3cee98fc88cb76faf4344ea67697b274` | npm 4.2.6，真实数据访问与解析                            |
| [CoLearner-MCP](https://github.com/JamesCai23/CoLearner-MCP)                 | `0bd1a224a7c54c5450dc229574b53c8f6ec00fc7` | 参考按课程导航、文件下载的工具分工，不复制实现           |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | `b022522089a0c8b632595c6e7b536453945ed5a9` | 稳定 v2：`@modelcontextprotocol/server` / `client` 2.3.1 |

旧包 `@modelcontextprotocol/sdk` 的 latest 是 1.32.1，不应把它当作 v2。阅读官方 `examples/guides/serving/stdio.examples.ts`、`test/e2e/fixtures/stdio-server.ts`；采用 `McpServer`、Zod 对象 schema、`StdioServerTransport` 和真实 stdio client 测试。

### 已核实的 Learn2018Helper 接口

- `getCurrentSemester()` / `getSemesterIdList()` / `getCourseList(semesterID, CourseType.STUDENT)`。
- `getHomeworkList(courseID)` 同时查询未交、已交未批、已批列表，并读取每项 HTML 附件和详情 API。`getHomeworkDetail` 是 private，不能假装可直接调用。`get_assignment` 由列表结果按学生作业 ID 查找；同时保留 baseId。学生模型没有发布时间，返回 null。
- `getNotificationList(courseID)` 合并有效与过期公告，可获取正文、时间和附件。浏览附件详情可能更新学校的已读/访问统计，这是只读查询的服务端附带行为。
- `getFileList(courseID)` 附带分类、真实文件 ID、大小、类型、下载链接。上游默认最多 200 条；返回分页仅作用于已取回的数据，达到上限时必须提示可能不完整，不能宣称全量。
- Git HEAD 有公开 `fetchWithToken(url, init)`，但 npm 4.2.6 安装包没有公开该方法（已由类型检查和安装包 JS 核对）。下载使用已公开的 `getCSRFToken()` / `addCSRFTokenToUrl()` 配合同一个注入请求层，不调用不存在的方法。API 错误是 `ApiError` / `FailReason`，`extra` 可能含原始数据，不回传或记录。

### 认证核查与决定

4.2.6 的 `HelperConfig` 只有 provider 和预览选项；源码私有 Cookie jar 没有导入/导出方法。README/构造器注释中的 CookieJar 描述与当前实现不符。`login` 首先尝试已有会话获取 CSRF，失败才调用凭据提供器。无密码 `checkSingle` 仍依赖上游识别设备/身份状态与 fingerprint，不能承诺浏览器完成认证后仅凭 fingerprint 一定可用。

采用 pnpm 可审计补丁：只给 HelperConfig 增加 `fetch?: Fetch`，构造器选择注入 transport；不修改 API 路径/解析/业务行为，不访问私有字段，不全局替换 fetch。补丁同时覆盖安装包 JS 与声明。后续可向上游提 PR，正式支持后删补丁。

独立 `auth login` CLI 用 Playwright 打开有界生命周期的浏览器，让用户自行完成验证码/二次认证。只导出适用于 learn.tsinghua.edu.cn 的 Cookie，保留 path/secure/expiry/HttpOnly/SameSite，将适用的父域 Cookie 收窄到 Learn 域后导入 tough-cookie。用真正的 helper `login()` + `getCurrentSemester()` 验证后才保存。不会读取密码、设备指纹、localStorage，不暴露登录工具给模型。MCP 启动不自动弹浏览器。

会话默认在用户数据目录、仓库外。Windows 用 CurrentUser DPAPI 加密并收紧目录 ACL；POSIX 目录 0700、文件 0600，不声称 POSIX 明文凭据具有静态加密。原子保存并拒绝符号链接；不同进程不合并会话更新，交互登录后重启客户端最可靠。鉴权失败不重试密码流程，只要求用户在自己的终端重新认证。

浏览器 Cookie 转移到真实上游 helper 的机制必须经 Mock HTTP 合约测试证明；是否适用于当前学校账号、网络、风控只能真人登录实测确认。

2026-10-11 补充：用户本人在独立浏览器完成学校认证，导出的 Cookie 经真实 helper 验证并保存。随后一个全新的 MCP Server 进程成功复用会话，查询当前学期课程、作业、公告和课件，并完成 PDF 下载。该结果验证了本次账号/网络条件下的接线，不推断其他账号、所有二次认证分支或长期有效期。

## 分层

```text
stdio / McpServer → Zod Tool handlers → LearnService → LearnApi interface
                                                    ↓
                                       ThuLearnAdapter → thu-learn-lib
                                                    ↓
                                  AuthenticationManager / safe HTTP / CookieJar
```

- 领域模型不引用 MCP 或上游类型，显式 null 表示不可获取值，课程/作业/文件保留 ID 和 source_url。
- 服务层负责筛选、分页、缓存、跨课程聚合。串行聚合；底层限制并发与请求频率，网络/5xx 最多额外重试两次，429 立即停止。失败课程放在 `warnings`，设置 `complete: false`，认证失败整体报错。
- 稳定 JSON envelope：成功 `ok/data/warnings/complete`；失败 `ok/error`，MCP 同时返回 `structuredContent` 与 JSON text，并设置 isError。
- 使用独立 submission_status 和 deadline_status；展示 status 区分 submitted/unsubmitted/overdue/unknown。窗口为当前时刻到 N×24 小时后，可选回溯逾期天数。所有时间输出 ISO 8601 `+08:00`，固定 Asia/Shanghai。上游用无时区字符串构造 Date，进程入口必须先设置 TZ，再加载应用，并测试不同宿主 TZ。
- 缓存仅在内存，短 TTL，认证状态变化清空；列表和详情共用结果，减轻上游 N+1 请求。分页不声称节省上游列表请求。
- 下载仅接受 course_id + file_id，不接受任意 URL/输出路径。可信元数据解析出的 URL 限制为学校固定 HTTPS origin，重定向逐跳校验。文件名优先 Content-Disposition，拒绝路径穿越、Windows 设备名/ADS，创建独占文件，限制总字节数并清理失败残留。
- 不实现提交/修改/删除工具；工具输出来自不可信课程内容，不能当作指令。download 的 MCP readOnlyHint 为 false（本地写文件），其余 true。
- stdio stdout 只有协议；日志只用 stderr 和固定错误分类，不含 URL、Cookie、正文、原始异常。

## 实施与验收计划

1. 固定依赖，提交补丁和设计；完成网络、会话存储、认证 CLI 与可替换接口。
2. 实现真实适配器、领域模型、服务层和 8 个工具；缺少认证仍可 tools/list 和 auth_status。
3. Vitest：模拟上游 helper/HTTP 的查询、Cookie 复用、过期、重试/超时、时区/DDL、路径/覆盖/大小等；真实 MCP Client 启动子进程验证工具发现、结构化调用和错误，不给生产入口增加 Mock 开关。
4. typecheck / lint / build / test；README 提供本机首次认证、Codex/Claude 实际配置与手工验收步骤。自动测试与学校实测分别报告。

## 已知风险与演进

首版仅学生身份；旧学期显式指定 semester_id。上游列表上限和 N+1 放大是已知限制。站点 HTML、Session 风控和文件 CDN 可能变化；未知外域下载失败关闭，需人工确认后增加精确允许域。服务器关闭会中断网络和队列；单个 tools/call 的取消传播尚未实现。无真实账号时不承诺免登录天数，不把 Mock 成功当作学校集成成功。后续优先：上游请求注入正式接口、服务端分页、逐工具取消传播、文件流式传输、TA 模式、CLI 查询与 HTTP transport。

## 依赖兼容与审计补充

实际安装包与 Git HEAD 存在差异，已以上述安装包接口修正下载实现。TypeScript 7 超出了当前 typescript-eslint 的 peer 范围，采用兼容的 6.0.3。首次 `pnpm audit --prod` 检出 thu-learn-lib 安装包依赖 sm-crypto 0.4.0 的 [GHSA-vh45-f885-3848](https://github.com/advisories/GHSA-vh45-f885-3848)，通过 pnpm override 锁定 0.5.7 后审计为零已知漏洞；本项目不使用库的密码加密登录路径。
