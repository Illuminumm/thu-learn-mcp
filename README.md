# THU Learn MCP Server

[![Checks](https://github.com/Illuminumm/thu-learn-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Illuminumm/thu-learn-mcp/actions/workflows/ci.yml)
[MIT License](LICENSE) · Node.js 24.13+ · MCP SDK v2 · stdio

清华大学网络学堂的本地、只读 MCP Server。让 Codex CLI、Claude Code 等客户端按课程查询作业、公告、课件，并聚合截止时间、下载课件。非清华大学官方项目，MIT 许可。

A local, read-only MCP server for Tsinghua University's Learn platform. Human-in-the-loop login, reusable local sessions, and structured course data over stdio.

- 查询当前或指定学期的课程、作业详情、公告与课件。
- 聚合 Asia/Shanghai 时区的作业截止日期，保留提交状态与来源链接。
- 通过本人浏览器认证复用会话，课件下载到指定本地目录。
- 不实现作业提交、修改或删除，不采集密码，也不上报遥测。

[安装与登录](#安装) · [Codex CLI](#codex-cli) · [Claude Code](#claude-code) · [工具契约](#工具契约) · [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md)

**实现状态：8 个工具已实现，并于 2026-10-11 使用真实学校账户通过 MCP stdio 完成调用验证，包括浏览器认证、跨进程会话复用、课程、作业、公告、DDL 和一份 PDF 课件下载。** 实测范围与自动化测试结果分别记录在 [验收记录](docs/verification.md)；尚未验证长期会话有效期、历史学期和所有课程/文件类型。首次使用仍需完成下述浏览器认证。

## 安装

需要 Node.js **24.13 或更高**（建议 Node 24 LTS）、pnpm **11.17.0**，以及首次认证时可用的桌面浏览器环境。Windows 使用自带 Windows PowerShell 和 `icacls` 保护会话。

```sh
node --version
npm install --global pnpm@11.17.0
git clone https://github.com/Illuminumm/thu-learn-mcp.git
cd thu-learn-mcp
# 在本仓库根目录执行
pnpm install --frozen-lockfile
pnpm build
# 浏览器仅用于人工登录，MCP 查询运行时不需要启动浏览器
pnpm exec playwright install chromium
```

Linux 若缺浏览器系统依赖，可执行 `pnpm exec playwright install --with-deps chromium`。这个步骤可能需要系统管理员权限；不要用 root 身份运行本服务。

锁定 MCP SDK v2 的 `@modelcontextprotocol/server` / `client` 2.3.1、`thu-learn-lib` 4.2.6、Zod、Vitest；TypeScript 6.0.3 满足当前 ESLint 类型解析器的兼容范围。pnpm 自动应用 `patches/` 中的最小请求注入补丁，**不要用 npm install 替代 pnpm**。`pnpm-workspace.yaml` 还将上游间接依赖 sm-crypto 固定到修复版本 0.5.7。

项目目前以源码仓库安装，`private: true` 防止误发布到 npm。研究用 `.research/` 不属于交付源码，也不是运行依赖。

## 首次登录与 Session

在你自己的终端执行，不要把账号、密码、Cookie 或设备指纹发送到 Agent 对话：

```sh
pnpm auth login
pnpm auth status
```

1. `login` 打开独立的可见 Chromium 窗口。
2. 在学校页面自行完成统一身份认证、验证码和二次认证，并进入学生课程首页。最多等待 10 分钟。
3. 程序仅导出适用于 `learn.tsinghua.edu.cn` 的 Cookie，不读取密码、localStorage 或设备指纹。
4. 将 Cookie 导入同一个受限 HTTP 请求层，用真实 `thu-learn-lib.login()` 获取 CSRF，再调用当前学期接口验证。只有验证成功才保存会话；验证失败不会用模拟结果代替。
5. 启动或重启 MCP 客户端。`auth_status` 为 `authenticated: true` 后再查询课程。

会话默认位置：

| 平台        | 目录                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| Windows     | `%LOCALAPPDATA%/thu-learn-mcp`                                           |
| Linux/macOS | `$XDG_STATE_HOME/thu-learn-mcp`，未设置则 `~/.local/state/thu-learn-mcp` |

Windows 会话文件使用 **当前系统用户 DPAPI 加密**，目录去除继承权限并限制为当前用户；POSIX 使用目录 0700、文件 0600，**POSIX 文件没有静态加密**。不要把会话目录放进仓库、同步盘或共享目录。自定义会话目录必须专用，程序拒绝在包含无关文件的目录修改权限。

登录态时长由学校决定，本项目不承诺固定天数，也不绕过验证码或二次认证。会话失效会返回 `AUTH_REQUIRED`，再次执行 `pnpm auth login`。`pnpm auth clear` 只清除本机保存的会话，不执行学校退出登录接口。服务会读取新会话；更换账号时先停止客户端、重新登录、再启动，避免多个进程同时更新旧会话。

现有浏览器 Cookie 并不能直接传入原版 thu-learn-lib 4.2.6。项目补丁增加的是可测试的 fetch 注入接口，由 tough-cookie 管理作用域和有效期；它没有改变学校认证流程，也没有引入密码登录降级路径。详见 [技术设计](docs/architecture.md)。

## 配置与运行

```sh
pnpm typecheck
pnpm lint
pnpm format:check    # 检查代码与文档格式；pnpm format 自动整理
pnpm build
pnpm test             # 自动先构建，再运行所有测试
pnpm test:protocol    # 实际 SDK Client + stdio 子进程
pnpm test:browser     # 可选：已安装 Chromium 后运行，只使用本地拦截的模拟网页
pnpm verify:live      # 可选：需要本人已登录；访问学校并下载一份较小的 PDF
pnpm check           # format + typecheck + lint + build + tests
pnpm start           # 仅终端排障；启动后等待 MCP stdin 是正常现象
```

MCP 客户端配置直接使用 `node /绝对路径/dist/index.js`，避免包管理器横幅污染协议。服务 stdout 只写 JSON-RPC，诊断写 stderr。关闭客户端输入或发送退出信号可终止服务。

环境变量均为非敏感配置：

| 变量                        | 默认值                      | 约束                                    |
| --------------------------- | --------------------------- | --------------------------------------- |
| `THU_LEARN_SESSION_DIR`     | 上述用户数据目录            | 专用绝对路径                            |
| `THU_LEARN_DOWNLOAD_DIR`    | `~/Downloads/thu-learn-mcp` | 绝对路径；拒绝符号链接路径              |
| `THU_LEARN_TIMEOUT_MS`      | 20000                       | 每个 HTTP 请求含读取响应体，1000–120000 |
| `THU_LEARN_RETRIES`         | 2                           | 额外重试次数，0–2；只重试网络/超时/5xx  |
| `THU_LEARN_INTERVAL_MS`     | 200                         | 请求最小间隔，100–10000                 |
| `THU_LEARN_CACHE_TTL_MS`    | 60000                       | 列表内存缓存，0–300000                  |
| `THU_LEARN_MAX_DOWNLOAD_MB` | 64                          | 每个下载上限，1–256 MiB                 |

`.env.example` 可复制为 `.env`，但不会自动加载。若使用它，认证与服务都应显式加载同一个文件：

```sh
node --env-file=.env dist/auth-cli.js login
node --env-file=.env dist/index.js
```

MCP 配置推荐直接传 `env`。不会读取或使用 `OPENAI_API_KEY`，也不连接模型 API。代理由你的系统/Node 网络环境负责；不关闭 TLS 证书校验。

## Codex CLI

将示例中的 `/absolute/path/thu-learn-mcp` 替换为你的仓库绝对路径；Windows 可使用 `C:/projects/thu-learn-mcp` 这种正斜杠写法。配置格式已核对 [Codex 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

```sh
codex mcp add thu-learn -- node /absolute/path/thu-learn-mcp/dist/index.js
codex mcp list
```

或在 `~/.codex/config.toml` 中加入以下配置。两种方式选一种；自定义目录必须与认证 CLI 使用的一致。

```toml
[mcp_servers.thu-learn]
command = "node"
args = ["/absolute/path/thu-learn-mcp/dist/index.js"]
startup_timeout_sec = 20
tool_timeout_sec = 180

[mcp_servers.thu-learn.env]
THU_LEARN_DOWNLOAD_DIR = "/absolute/path/thu-learn-downloads"
```

不需要给 Codex 提供学校密码，也不需要 `codex mcp login`；那是 MCP OAuth 登录，与这里的独立学校认证不同。

## Claude Code

参照 [Claude Code 官方 MCP 文档](https://code.claude.com/docs/en/mcp)：

```sh
claude mcp add --transport stdio --scope user thu-learn -- node /absolute/path/thu-learn-mcp/dist/index.js
claude mcp get thu-learn
```

也可以将下列内容保存到项目 `.mcp.json`，进入 Claude Code 后批准项目 MCP 配置：

```json
{
  "mcpServers": {
    "thu-learn": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/thu-learn-mcp/dist/index.js"],
      "env": { "THU_LEARN_DOWNLOAD_DIR": "/absolute/path/thu-learn-downloads" }
    }
  }
}
```

Windows 直接运行 `node`，无需 `cmd /c npx`。如果客户端找不到 node，将 `command` 改为本机 `node.exe` 的绝对路径。Linux/macOS 替换为当地绝对路径即可。

## 工具契约

所有工具在 `tools/list` 中提供 Zod 生成的 `inputSchema` 和 `outputSchema`。业务结果同时返回 `structuredContent` 和相同内容的 JSON 文本，统一字段如下：

```json
{
  "ok": true,
  "data": { "items": [], "total": 0, "offset": 0, "limit": 50, "next_offset": null },
  "warnings": [],
  "complete": true,
  "error": null
}
```

业务失败为 `ok: false, data: null, complete: false, error: {code, message}`，同时设置 MCP `isError: true`。参数不符合 Schema 时由 SDK 返回 MCP 工具校验错误；**这类错误不保证带业务 envelope**。未知工具/协议格式错误使用 SDK 标准协议错误。

`null` 表示上游缺失或不能可靠取得，不会编造数值。时间是 `Asia/Shanghai` 的 ISO 8601 `+08:00`。正文提供纯文本并保留换行；作业详情另有清理后的 `description_html`，保留表格、学校图片链接和数学内容，移除脚本、事件属性、非学校链接和认证参数。HTML 仍是不可信资料，本服务不渲染或执行它。文件本身可能包含主动内容，本服务只下载，不执行。

共同参数：`semester_id?` 默认当前学期；查询历史课程时必须指定对应学期。分页 `offset=0`、`limit=50`（1–100），`next_offset=null` 表示本次获取的数据已读完。ID 取自前序工具，不是课程名称。`total` 是当前筛选后、已获取的条数；`complete` 描述上游覆盖情况，不等同于当前页是否最后一页。

| 工具                     | 参数                                                                                                         | `data` 主要字段                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_status`            | `{}`                                                                                                         | `authenticated`, `needs_reauthentication`, `state`, `checked_at`, `guidance`, `error_code`；执行实时请求，不输出任何凭据                                                                                          |
| `list_courses`           | `semester_id?`, `offset?`, `limit?`                                                                          | 分页课程：`course_id`, `name`, `teacher`, `semester_id`, `course_number`, `source_url`                                                                                                                            |
| `list_assignments`       | `course_id?`, `semester_id?`, `submission_status?`, 分页                                                     | 作业摘要：`course_id`, `assignment_id`, `base_assignment_id`, `title`, `description_summary`, `published_at`, `deadline`, `late_submission_deadline`, `submission_status`, `graded`, `submitted_at`, `source_url` |
| `get_assignment`         | `course_id`, `assignment_id`, `semester_id?`                                                                 | 完整 `description`、`description_html` 和上述元数据；`attachments[]`: `file_id`, `name`, `size_display`, `source_url`, `kind`（题目或教师答案）                                                                   |
| `list_announcements`     | `course_id`, `semester_id?`, `order?=desc`（asc/desc）, 分页                                                 | `announcement_id`, `course_id`, `title`, `content`, `published_at`, `publisher`, `source_url`                                                                                                                     |
| `list_course_files`      | `course_id`, `semester_id?`, `query?`, `extension?`, `category_id?`, 分页                                    | `file_id`（真实下载 ID）, `entry_id`（课件条目 ID）, `name`, `description`, `extension`, `size_bytes`, `size_display`, 分类、`uploaded_at`, `source_url`                                                          |
| `download_course_file`   | `course_id`, `file_id`, `semester_id?`                                                                       | `local_path`, `filename`, `size_bytes`, `sha256`, `course_id`, `file_id`, `source_url`                                                                                                                            |
| `get_upcoming_deadlines` | `days?=7`（1–90）, `overdue_days?=0`（0–90）, `include_submitted?=false`, `course_id?`, `semester_id?`, 分页 | 分页截止项，另含 `as_of`, `window_start`, `window_end`, `time_zone`, `unknown_deadline_count`                                                                                                                     |

`list_assignments` 的 `submission_status` 是 `submitted/unsubmitted/unknown`。学生接口没有作业发布时间，`published_at` 始终为 null。`get_assignment` 通过上游作业列表组合实现，不调用上游 private 方法；不输出其他同学的优秀作业、你的提交正文或评分附件。

DDL 窗口为闭区间 `[当前时刻 − overdue_days×24h, 当前时刻 + days×24h]`，按截止时间升序。每项保留独立的 `submission_status` 和 `deadline_status`（upcoming/overdue），并给出 `status`（submitted/unsubmitted/overdue/unknown）。已提交但截止时间已过时，两种事实都保留；状态不明的作业不会推断为未提交。缺失截止时间的作业不进入窗口，用 `unknown_deadline_count` 和 warning 提示。

跨课程请求遇到某课程网络失败时返回其余结果和带 `course_id` 的 warning，并设置 `complete: false`；认证失败或 429 整体停止。单课程错误直接返回失败。默认缓存 60 秒，因此刚提交作业后最多可能看到约一分钟旧状态。

下载工具不接受任意 URL、任意保存路径或覆盖参数。目标目录只来自本地配置；优先采用服务器 Content-Disposition 的文件名和扩展名，缺失时用课件名称与文件类型补全。文件名包含穿越路径、Windows 设备名或 ADS 时拒绝，重名返回 `FILE_EXISTS`。它会在本地创建文件，所以 `readOnlyHint=false`；学校业务仍然只读。

示例调用参数：

```json
{ "days": 14, "overdue_days": 3, "include_submitted": false, "limit": 100 }
```

## 验证与手工验收

`pnpm check` 覆盖：课程/作业/公告真实适配器与 Mock HTTP 合约、浏览器 Cookie 导入和跨管理器复用、认证失效/网络错误、有限重试/429/超时、DDL 与不同父进程时区、路径穿越/重名/符号链接/大小限制、私有会话存储、SDK v2 Client 发现并调用全部八个工具、生产入口未登录行为、stdout JSON-RPC 纯净度与 stdin EOF 退出。

`pnpm check`、`test:protocol` 和 `test:browser` 不访问学校，不需要真实凭据，不把 Mock 注入生产入口。协议测试真正启动子进程，不只调用 handler 函数。Windows DPAPI 和 Chromium 启动/分路径 Cookie 导出在本机已经实际运行；GitHub Actions 的 Windows/Ubuntu 检查也已通过，包括 Ubuntu 的 POSIX 会话存储与模拟浏览器检查。macOS 尚未验证，详见 [验证记录](docs/verification.md)。

`pnpm verify:live` 是单独的主动验收命令，**不在 Vitest 或 CI 中自动运行**。它使用已保存的真实会话，通过 SDK Client 启动生产 Server，检查八个工具、读取当前学期课程与作业、抽查详情和公告、核对过去/未来各 7 天的 DDL，并按课程查找一份 PDF 下载。下载上限为本地配置和 8 MiB 中的较小值，文件保存在配置下载目录下的 `verification-时间戳/` 子目录，检查文件头、大小、扩展名和 SHA-256。日志仅含统计与下载文件路径，不输出课程正文或认证信息。空学期或没有合适 PDF 时会明确标记相应步骤 `skipped`；上游 warning 或错误会使验收失败，不能当作全部通过。大量课程的首次作业读取可能耗时数分钟。

真实验收请在认证成功后完成：

1. 调用 `auth_status`，检查 authenticated=true；重启 MCP 进程再次检查，验证实际 Session 可复用。
2. `list_courses` 对照网站课程列表；旧学期显式传 `semester_id`。
3. 对一个课程调用 `list_assignments` 与 `get_assignment`，核对完整说明、附件、未交/已交状态和 DDL。
4. `list_announcements` 对照网站内容与时间；`list_course_files` 核对名称、类型和大小。
5. 下载一个课件，确认可打开、扩展名正确；再次下载同文件应返回 FILE_EXISTS。
6. `get_upcoming_deadlines` 与网站人工核对，查看 warnings。实际 Session 自然失效时再次调用应给出重新认证指引。

不要向公开 issue 上传 Cookie、原始响应、带认证参数的 URL 或个人课程正文。可以提供脱敏错误 code、依赖版本和复现步骤。

## 故障排查

| 情况                        | 处理                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `AUTH_REQUIRED`             | 在本机终端 `pnpm auth login`；确认已进入学生课程首页，学校验证码/二次认证须本人完成                     |
| `SESSION_INVALID`           | 会话损坏、权限过宽或来自其他 Windows 用户；使用原系统用户重新认证                                       |
| `BROWSER_UNAVAILABLE`       | 运行 `pnpm exec playwright install chromium`，从有桌面的终端登录                                        |
| `NETWORK_ERROR` / `TIMEOUT` | 检查本机能否访问学校、校园网络/VPN/代理，稍后再试；不要关闭 TLS 校验                                    |
| `RATE_LIMITED`              | 停止请求，稍后重试；429 不自动重试                                                                      |
| `NOT_FOUND`                 | 用前序工具返回的 ID，确认学期；教师/TA 课程不在首版范围                                                 |
| `UPSTREAM_ERROR`            | 学校接口或 HTML 结构可能变化；保存非敏感错误 code，并检查上游版本                                       |
| `UPSTREAM_LIMIT` warning    | 上游数据可能受截断；本地分页无法突破上游上限，应与网页核对                                              |
| `FILE_EXISTS`               | 文件已存在且未被覆盖，使用本地已有文件；需要重新下载时由你自行重命名或移走旧文件                        |
| `UNSAFE_PATH`               | 检查下载目录是否有符号链接、服务端文件名是否异常；不支持跳转到其他域名的下载                            |
| `FILE_TOO_LARGE`            | 文件超出配置上限；确认大小后调整 THU_LEARN_MAX_DOWNLOAD_MB                                              |
| `STORAGE_ERROR`             | 目录需当前用户可写且为专用目录；Windows 要能运行 PowerShell/DPAPI/icacls                                |
| tools/list 连接失败         | 先 pnpm build，使用绝对路径和 `node dist/index.js`，检查 Node 版本、stderr 与客户端配置                 |
| 大量课程查询较慢            | 上游按作业获取详情，首次会产生多次请求；可先指定课程，适当增加客户端 tool timeout，避免同时重复全量聚合 |

## 结构、边界与 Roadmap

```text
src/
  domain/    独立领域 Schema、错误、时间
  auth/      交互式登录、会话存储、认证管理
  infra/     受限 HTTP、互斥限流、安全下载
  adapter/   thu-learn-lib → 领域模型
  service/   查询、筛选、分页、DDL 聚合
  mcp/       Zod 工具注册与 MCP envelope
  index.ts   stdio 入口
  auth-cli.ts
tests/       单元/合约/子进程协议测试，以及独立的 live-verify.ts
patches/     安装包 fetch 注入补丁
docs/        调研、架构和验收记录
```

首版仅学生身份、stdio、本机单用户。不上报遥测，不调用第三方模型或存储服务；返回的课程内容会交给你配置的 MCP 客户端，该客户端是否发送给模型提供商由其设置决定。登录页面依赖由学校控制，本服务不采集它们。课程文字视为不可信资料，不能执行其中要求泄露凭据或操作系统的指令。

学校侧没有提交、删除、编辑动作；读取详情/下载可能增加学校的访问量、下载量或已读统计。严格零副作用无法由客户端保证。

已知限制：上游课件列表最多 200 条；作业/公告列表使用上游默认分页，不保证超大型课程全量；接口/HTML 可变；作业详情按课程列表读取；图片、数学公式的完整视觉排版仍需原始网页/附件；文件目前先在内存中有界缓冲（默认 64 MiB）；只允许学校固定 HTTPS 域，未知 CDN 会拒绝；多个 MCP 进程没有跨进程 Session 合并；取消消息暂不立即取消整批已排队查询，但单次网络请求有超时。

后续优先：长期 Session 与更多课程/历史学期验收、向上游提交 fetch 注入支持、真正的服务端分页和详情接口、取消传播、流式下载、操作系统钥匙串支持、TA/教师身份、独立查询 CLI、HTTP Transport。第一版不计划加入作业提交功能。

## 调研来源

- [thu-learn-lib 源码与类型](https://github.com/Harry-Chen/thu-learn-lib)：认证、课程与文件 API；本项目优先复用。
- [CoLearner-MCP](https://github.com/JamesCai23/CoLearner-MCP)：参考网络学堂工具分工；其页面导航前置条件、密码参数、DOM 依赖和 stdout 日志不适用于本项目目标，未复制代码。
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)：稳定 v2 stdio Server/Client 示例。
- [设计与版本证据](docs/architecture.md)、[验收记录](docs/verification.md)、[安全说明](SECURITY.md)。
