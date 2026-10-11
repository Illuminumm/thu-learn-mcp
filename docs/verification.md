# 验证记录

日期：2026-10-11。执行环境：Windows、Node.js v24.13.1、pnpm 11.17.0。以下分别记录不访问学校的自动化测试，以及使用者本人完成认证后的真实接口抽样。公开记录仅保留验证方法和结论，不包含个人课程统计、课程/作业 ID、正文、文件名、文件哈希或认证信息。

## 实际执行结果

| 命令/检查                                                      | 结果                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                               | 通过，锁文件和补丁可重建                                                                              |
| 独立无 node_modules 目录安装：`pnpm install --frozen-lockfile` | 通过，自动应用 thu-learn-lib 补丁                                                                     |
| `pnpm typecheck`                                               | 通过，strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes                                      |
| `pnpm lint`                                                    | 通过，无显式 any，无服务端 console 日志                                                               |
| `pnpm build`                                                   | 通过，生成 `dist/index.js` 和 `dist/auth-cli.js`                                                      |
| `pnpm test` / `pnpm check`                                     | **6 个测试文件、42 项测试全部通过**                                                                   |
| 独立安装目录 `pnpm check`                                      | 同样 42 项通过                                                                                        |
| `pnpm exec playwright install chromium`                        | 通过，安装实际配套 Chromium                                                                           |
| `pnpm test:browser`                                            | 通过，实际 Chromium 启动、页面请求全部本地拦截、Cookie 域/路径导出检查                                |
| `pnpm peers check`                                             | 无 peer dependency 冲突                                                                               |
| `pnpm audit --prod`                                            | 无已知漏洞；已用 0.5.7 替换间接依赖 sm-crypto 0.4.0                                                   |
| 未登录时 `pnpm auth status`                                    | 当时返回 `state: missing`、`authenticated: false`、`needs_reauthentication: true`；随后已完成真人认证 |

独立目录位于 Git 忽略的 `.research/clean-check`，只复制源码、测试、补丁与构建配置，不复用主工程 node_modules。

开源整理后额外从 Git 暂存树导出纯源码到独立目录，再次执行 `pnpm install --frozen-lockfile` 和 `pnpm check`：格式检查、类型检查、Lint、构建及 42 项测试全部通过。主目录也重新通过模拟浏览器检查与生产依赖审计。待提交文件的本地检查未发现个人路径、真实验收样本统计或常见凭据模式；这类模式扫描不能替代内容审阅。公开版本保留了方法与结果，移除了个人课程数量和下载文件特征。

首次公开提交 `5b936ef` 的 [GitHub Actions 运行记录](https://github.com/Illuminumm/thu-learn-mcp/actions/runs/38116957619) 已通过：Windows 与 Ubuntu 均完成锁文件安装、`pnpm check` 和生产依赖审计，Ubuntu 另通过实际 Chromium 的本地模拟认证检查。两套 CI 都没有学校凭据，也未运行 `verify:live`。Ubuntu 运行覆盖了 POSIX 会话文件权限分支；macOS 尚未运行。

## 自动化测试已验证的边界

- SDK v2 Client 通过 stdio 启动实际 Server 子进程，完成 initialize、tools/list、全部八个 tools/call；检查 input/output schema、结构化结果、参数错误、NOT_FOUND、FILE_EXISTS。
- 单独启动编译后的生产入口，未登录情况下仍可发现工具并获取非敏感认证状态，课程查询返回 AUTH_REQUIRED。
- 捕获生产 stdout，验证只出现 JSON-RPC，stdin EOF 后退出。另验证服务关闭时中止正在执行与排队的 HTTP 请求。
- 合约测试直接实例化安装后的 Learn2018Helper，模拟学校 HTTP 原始响应，由真实库解析课程、作业 HTML/说明/附件、公告、课件和下载。
- 完整作业详情的清理后 HTML 保留图片、表格和数学内容，同时移除脚本、事件属性、不安全链接与 URL 中的认证参数。
- 将模拟浏览器 Cookie 导入 tough-cookie，通过真实 helper 获取 CSRF，再重新创建 AuthenticationManager 验证已保存会话可复用。这证明本地接线机制；不证明学校不会额外绑定浏览器或设备。
- 真实 Chromium 中设置无效于学校的合成 Cookie，校验不同路径、HttpOnly、Secure 和排除其他域 Cookie。所有网页请求由 Playwright route 本地拦截，不访问学校。
- 认证缺失/失效、网络失败、错误 JSON、HTML 结构变化、登录页面返回、外域/HTTP 重定向、429、有限重试、超时与大小上限。
- DDL 排序、窗口边界、逾期/已提交/未知状态、缺失日期；在 UTC 和 America/New_York 父进程下运行，真实上游的无时区日期仍规范化为 Asia/Shanghai。
- 下载拒绝路径穿越、Windows 设备名、ADS、符号链接目录；保持 Unicode 和版本号文件名及扩展名，不覆盖既有文件，超限/错误响应清理残留。
- Windows DPAPI 实际加密/解密与目录权限设置，磁盘密文不包含测试 Cookie 明文；损坏 Session 和包含无关文件的目录被拒绝。

## 真实学校接口验收

在使用者授权下运行 `pnpm auth login`，本人在可见 Chromium 中完成认证；真实 `thu-learn-lib.login()` 和当前学期请求通过后，CLI 以退出码 0 结束，并将会话保存在用户私有目录的 DPAPI 密文文件中。没有向 Agent 提供密码、Cookie 或 Token。

随后运行 `pnpm verify:live`，通过 SDK v2 Client 启动编译后的生产 `dist/index.js`，没有注入 Mock；实际调用结果如下：

| 操作                     | 本次真实结果与验收范围                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `tools/list`             | 发现全部 8 个工具                                                                                           |
| `auth_status`            | `authenticated: true`；登录 CLI 结束后由全新的 MCP 进程复用磁盘会话                                         |
| `list_courses`           | 当前学期返回非空课程列表，结构化输出通过 SDK Schema 校验                                                    |
| `list_assignments`       | 跨课程查询成功，返回已提交和未提交作业，结构化输出通过校验；无 warning                                      |
| `get_assignment`         | 抽查作业，返回纯文本、清理后 HTML 和附件元数据；ID、标题与列表一致                                          |
| `list_announcements`     | 课程抽样返回非空公告列表，发布时间降序校验通过                                                              |
| `get_upcoming_deadlines` | 过去 7 天至未来 7 天、包含已提交项；数量与作业列表计算结果一致，顺序正确，时间均为 `+08:00`                 |
| `list_course_files`      | 查询部分课程，返回课件元数据，找到适合下载的 PDF 后停止继续抽样                                             |
| `download_course_file`   | 成功下载 PDF；真实服务器文件名与扩展名保留，落盘路径在指定目录内，PDF 文件头、实际大小与 SHA-256 复算均通过 |
| 生产进程与退出           | MCP 调用无协议污染，生产 stderr 为 0 字节，验收脚本退出码 0                                                 |

PDF 保存在本机配置下载目录的 `verification-时间戳/` 子目录，未复制进 Git 仓库。验证的是文件传输、文件头和内容哈希，未进行 PDF 逐页渲染，也没有声称其页面排版已经人工核对。这是一次账号/网络条件下的抽样，不保证学校接口持续不变。

复现命令：`pnpm auth login`（仅未登录或会话过期时）→ `pnpm verify:live`。脚本没有内置账号、课程 ID 或凭据；自动选择当前账户的样本。每次显式运行会访问学校并可能新下载一份 PDF，常规 `pnpm check` 不运行此脚本。

## 尚未验证

- 长期 Cookie 有效期、自然失效后的真实学校行为、不同网络/设备的风控，以及本次登录没有经历的验证码/二次认证分支。
- 网站人工逐项对照、历史学期、所有课程字段/HTML 变体、其他文件格式/大型文件和可能使用的 CDN；一次抽样不等于覆盖全部课程数据。
- Codex CLI / Claude Code 的真实交互会话接入；配置格式已核对官方文档，但没有修改本机客户端配置。
- macOS 的权限、浏览器与运行环境；Ubuntu 已通过 CI，但 Linux 上的真人学校认证尚未验证。

## 用户验收入口

在工作区终端执行 `pnpm auth login`，本人在弹出的窗口完成学校认证。只有真实 helper 验证成功后才会保存会话。然后按 README 的客户端配置和“真实验收”清单核对一个课程、一个作业、一份课件，并重启 MCP 验证实际会话复用。

此次真实认证、查询和下载已验证成功；Mock 故障测试、真实接口抽样与尚待人工核对的部分在上文分别列出。
