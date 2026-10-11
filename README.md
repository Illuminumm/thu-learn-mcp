# THU Learn MCP Server

[![Checks](https://github.com/Illuminumm/thu-learn-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Illuminumm/thu-learn-mcp/actions/workflows/ci.yml)
[MIT](LICENSE) · Node.js 24.13+ · TypeScript · MCP SDK v2 · stdio

清华大学网络学堂的本地、只读 MCP Server，让 Codex CLI、Claude Code 等客户端查询课程、作业、公告、课件和截止日期，并下载课件。非学校官方项目。

A local, read-only MCP server for Tsinghua Learn, with interactive login and reusable local sessions.

## 安装与登录

需要 Node.js **24.13+**、pnpm **11.17.0**；首次认证需要桌面浏览器环境。

```sh
npm install --global pnpm@11.17.0
git clone https://github.com/Illuminumm/thu-learn-mcp.git
cd thu-learn-mcp
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright install chromium
pnpm auth login
pnpm auth status
```

在弹出的学校页面自行完成登录、验证码和二次认证，进入学生课程首页后程序会验证并保存会话。登录最多等待 10 分钟；日常查询无需打开浏览器。Linux 缺少浏览器依赖时可运行 `pnpm exec playwright install --with-deps chromium`。

**不要在 Agent 对话中提供密码、Cookie 或 Token。** Windows 会话默认在 `%LOCALAPPDATA%/thu-learn-mcp`，用当前用户 DPAPI 加密；Linux/macOS 默认在 `$XDG_STATE_HOME/thu-learn-mcp`（未设置则 `~/.local/state/thu-learn-mcp`），使用 0700/0600 权限，文件没有静态加密。会话目录必须专用，并位于仓库和同步盘之外。

有效期由学校决定。过期后重新执行 `pnpm auth login`；`pnpm auth clear` 仅清除本机会话。更换账号时先停止 MCP，再登录并重启。首次登录成功已经由真实 `thu-learn-lib` 请求验证，不会以模拟结果代替。

当前采用源码安装。**不要用 npm install 替代 pnpm**：认证依赖锁文件中的请求注入补丁。`private: true` 仅防止误发 npm 包，不影响 GitHub 开源。补丁原理见 [架构说明](docs/architecture.md)。

## 接入 MCP 客户端

将 `/absolute/path/thu-learn-mcp` 替换为仓库绝对路径，Windows 可用 `C:/projects/thu-learn-mcp`。直接启动编译后的 Node 入口；stdout 只用于 MCP 协议，日志写 stderr。

### Codex CLI

在 `~/.codex/config.toml` 中加入（[官方配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)）：

```toml
[mcp_servers.thu-learn]
command = "node"
args = ["/absolute/path/thu-learn-mcp/dist/index.js"]
startup_timeout_sec = 20
tool_timeout_sec = 180
```

也可执行 `codex mcp add thu-learn -- node /absolute/path/thu-learn-mcp/dist/index.js`，再用 `codex mcp list` 检查。学校登录使用上面的认证 CLI，不使用 `codex mcp login`。

### Claude Code

项目 `.mcp.json`（[官方配置文档](https://code.claude.com/docs/en/mcp)）：

```json
{
  "mcpServers": {
    "thu-learn": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/thu-learn-mcp/dist/index.js"]
    }
  }
}
```

进入 Claude Code 后批准项目 MCP 配置。也可执行 `claude mcp add --transport stdio --scope user thu-learn -- node /absolute/path/thu-learn-mcp/dist/index.js`。客户端找不到 Node 时，把 `command` 改为 node 可执行文件的绝对路径。

## 工具

所有工具有 Zod 生成的输入/输出 Schema，同时返回 `structuredContent` 和等价 JSON 文本：

```json
{
  "ok": true,
  "data": { "items": [], "total": 0, "offset": 0, "limit": 50, "next_offset": null },
  "warnings": [],
  "complete": true,
  "error": null
}
```

业务失败返回 `ok: false`、`data: null`、`error: {code, message}`，并设置 MCP `isError`。参数校验错误由 SDK 返回，不保证有上述 envelope。

共同参数：`semester_id?` 默认当前学期；分页为 `offset=0`、`limit=50`（1–100）。`next_offset=null` 表示最后一页，`complete=false` 表示上游覆盖可能不完整；两者含义不同。ID 从前序工具取得。缺失值为 `null`，日期统一为 `Asia/Shanghai`、ISO 8601 `+08:00`。

| 工具                     | 参数（除共同参数外）                                                         | 返回内容                                                           |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `auth_status`            | `{}`，无共同参数                                                             | 实时认证状态、是否需要重登及指引，不含凭据                         |
| `list_courses`           | 分页                                                                         | 课程 ID、名称、教师、学期、课程号与来源链接                        |
| `list_assignments`       | `course_id?`、`submission_status?`、分页                                     | 作业 ID、摘要、截止时间、补交期限、提交状态与来源链接              |
| `get_assignment`         | `course_id`、`assignment_id`                                                 | 完整纯文本、清理后 HTML、题目/教师答案附件元数据                   |
| `list_announcements`     | `course_id`、`order?=desc`（asc/desc）、分页                                 | 公告 ID、标题、正文、发布时间、发布者与来源链接                    |
| `list_course_files`      | `course_id`、`query?`、`extension?`、`category_id?`、分页                    | 文件 ID、课件条目 ID、名称、类型、大小、分类、上传时间与来源链接   |
| `download_course_file`   | `course_id`、`file_id`                                                       | 本地路径、文件名、字节数、SHA-256、课程/文件 ID 与来源链接         |
| `get_upcoming_deadlines` | `course_id?`、`days?=7`、`overdue_days?=0`、`include_submitted?=false`、分页 | 按截止时间排序的作业、提交/逾期状态、查询窗口、时区及未知 DDL 数量 |

字段名与类型见 [领域 Schema](src/domain/models.ts) 和客户端 `tools/list`。详情保留 `course_id`、`assignment_id`、`source_url` 等溯源信息；不输出其他同学的优秀作业或自己的提交正文。学生接口没有作业发布时间，`published_at` 为 null。

- 提交状态为 `submitted/unsubmitted/unknown`。DDL 同时保留 `submission_status`、`deadline_status`（upcoming/overdue）和综合 `status`（submitted/unsubmitted/overdue/unknown）。
- DDL 窗口为 `[当前时刻 − overdue_days×24h, 当前时刻 + days×24h]`；`days` 为 1–90，`overdue_days` 为 0–90。缺失日期的作业排除并计入 `unknown_deadline_count` 和 warning。
- 跨课程的局部错误通过 `warnings` 和 `complete=false` 返回；认证失败或 429 整体停止。默认缓存 60 秒，刚提交后可能短暂显示旧状态。
- 下载只接受已查询到的文件 ID，保存到配置目录，拒绝路径穿越、符号链接、重名覆盖和未知外域。文件名优先采用服务器响应；本地写文件使其 `readOnlyHint=false`，学校业务仍只读。

例如查询未来两周及过去三天内尚未提交的作业：

```json
{ "days": 14, "overdue_days": 3, "include_submitted": false, "limit": 100 }
```

## 配置

通过 MCP 配置的 `env` 对象/表传入下列变量；自定义会话目录须与认证 CLI 一致。

| 变量                        | 默认值                      | 约束                                            |
| --------------------------- | --------------------------- | ----------------------------------------------- |
| `THU_LEARN_SESSION_DIR`     | 上述系统用户数据目录        | 专用绝对路径                                    |
| `THU_LEARN_DOWNLOAD_DIR`    | `~/Downloads/thu-learn-mcp` | 绝对路径，无符号链接                            |
| `THU_LEARN_TIMEOUT_MS`      | 20000                       | 单次请求含响应体，1000–120000                   |
| `THU_LEARN_RETRIES`         | 2                           | 额外重试 0–2 次；仅网络、超时或 5xx，429 不重试 |
| `THU_LEARN_INTERVAL_MS`     | 200                         | 请求最小间隔 100–10000                          |
| `THU_LEARN_CACHE_TTL_MS`    | 60000                       | 缓存 0–300000                                   |
| `THU_LEARN_MAX_DOWNLOAD_MB` | 64                          | 下载上限 1–256 MiB                              |

`.env.example` 可复制为 `.env`，但不自动加载；使用时认证和服务均需显式加载：

```sh
node --env-file=.env dist/auth-cli.js login
node --env-file=.env dist/index.js
```

`pnpm start` 用于终端排障，启动后等待 MCP stdin 是正常现象。代理由本机网络环境负责，不关闭 TLS 校验。

## 验证与开发

```sh
pnpm check           # 格式、类型检查、Lint、构建、Vitest
pnpm format          # 自动整理格式
pnpm audit --prod    # 生产依赖审计
pnpm test:protocol   # SDK Client + stdio Server 子进程测试
pnpm test:browser    # 需已安装 Chromium；全部网页请求在本地拦截
pnpm verify:live     # 仅本人已登录时手动运行；访问学校并下载一份 PDF
```

2026-10-11 已通过 **42 项自动化测试**、独立源码安装及 Windows/Ubuntu [CI](https://github.com/Illuminumm/thu-learn-mcp/actions/runs/38117072428)。覆盖查询合约、认证复用/失效、网络错误、DDL/时区、下载安全和 MCP 协议；常规测试与 CI 不访问学校、不需要账号。

同日 Windows 真实账户实测通过了浏览器登录、跨进程会话复用和全部 8 个工具，包含课程/作业查询、详情/公告抽样、DDL 聚合及 PDF 下载校验。长期会话、历史学期、所有课程/文件类型、macOS 和 Linux 真人认证尚未验证。

`verify:live` 下载上限为配置值与 8 MiB 的较小值，文件放在下载目录的 `verification-时间戳/` 中，核对 PDF 文件头、大小和 SHA-256；没有合适数据时标记 `skipped`，上游 warning 或错误使验收失败。它不进行 PDF 逐页渲染，也不代替与学校网页的人工核对。

贡献时说明问题、变更和实际验证结果；测试数据须手工构造，修改行为时补充对应测试。请勿提交凭据、真实课程正文、课件或原始网络日志。依赖升级须提交锁文件并重新检查上游安装包与补丁；代码分层和维护要点见 [架构说明](docs/architecture.md)。贡献遵循 [MIT 许可](LICENSE)。

## 常见问题

| 情况                                         | 处理                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `AUTH_REQUIRED` / `SESSION_INVALID`          | 用原系统用户重新 `pnpm auth login`，检查会话目录配置                      |
| `BROWSER_UNAVAILABLE`                        | 安装 Chromium，从有桌面的终端登录                                         |
| `NETWORK_ERROR` / `TIMEOUT` / `RATE_LIMITED` | 检查校园网络/VPN/代理；限流时停止请求，稍后再试                           |
| `NOT_FOUND`                                  | 使用工具返回的 ID，旧课程显式指定学期                                     |
| `UPSTREAM_ERROR` / `UPSTREAM_LIMIT`          | 接口或 HTML 可能变化，或列表受截断；报告脱敏错误并与网页核对              |
| `FILE_EXISTS`                                | 使用已有文件，或自行重命名旧文件后重试                                    |
| `UNSAFE_PATH` / `FILE_TOO_LARGE`             | 检查目录、文件名和下载上限；不允许外域重定向                              |
| `STORAGE_ERROR`                              | 检查目录权限；Windows 需要 PowerShell、DPAPI 和 icacls                    |
| MCP 连接失败 / 查询慢                        | 先构建、检查 Node 绝对路径与 stderr；先查单门课程，适当提高客户端工具超时 |

## 限制与后续

首版仅学生身份、stdio、本机单用户。上游课件列表最多 200 条，作业/公告使用上游默认分页，本地分页不保证突破学校上限。多进程会话不合并；单工具取消暂不立即中止整批查询；文件先在内存中有界缓冲。HTML 是不可信资料，复杂排版仍需查看原网页或附件。

服务不提供学校写操作；读取/下载可能更新学校的访问或已读统计。它不连接第三方模型或存储服务，但 MCP 客户端是否把课程内容发送给模型提供商由其设置决定。安全报告见 [SECURITY.md](SECURITY.md)。

后续优先：上游正式支持请求注入、服务端分页、取消传播、流式下载、更多环境验收，再考虑 CLI/HTTP Transport。第三方代码与课件版权见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
