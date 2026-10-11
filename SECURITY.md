# Security

This project is a local, single-user MCP server. Never attach credentials, session files, real course responses, or unredacted school URLs to a public report.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** entry when private vulnerability reporting is enabled. Do not put exploit details, credentials or school responses in a public issue. If that entry is unavailable, open an issue requesting a private contact channel without disclosing the vulnerability itself. We do not promise a response-time SLA.

Security fixes target the current main branch and latest release. There are no separately maintained older release lines yet. If credentials were exposed, remove the shared material and reauthenticate through the school's own account/session controls; deleting a Git file alone does not remove existing copies or history.

## Boundaries

- No password, cookie, token, or fingerprint MCP parameters. Human authentication runs in a separate desktop CLI.
- Production API requests and each redirect are limited to HTTPS `learn.tsinghua.edu.cn`. There is no arbitrary URL-fetch tool.
- The server has no telemetry, model provider, cloud store, or homework write tools. The selected MCP client controls how returned course data is used.
- Session data is outside the repository by default. Windows uses CurrentUser DPAPI and private ACLs; POSIX uses permissions, not encryption. The same OS user can still access/decrypt its own sessions. A hostile local administrator or compromised user account is outside this boundary.
- Download names are checked on all platforms against Windows and POSIX hazards. Exclusive file creation prevents replacement of an existing file or symlink. The configured directory and its ancestors must be trusted; symlink/junction components are rejected. This does not claim protection from another privileged local process changing directories during a filesystem operation.
- Error messages are fixed public messages. No raw upstream errors, extra response bodies, request URLs or cookies are logged. Do not add debug logging of these values.
- All upstream course content is untrusted data, including announcements and filenames. It is never executed. Clients must not follow instructions embedded in course content.

## Dependency policy

Use the committed pnpm lockfile and `pnpm install --frozen-lockfile`. The small thu-learn-lib fetch injection patch is required for session reuse without global monkey-patching. `pnpm-workspace.yaml` overrides its sm-crypto dependency to 0.5.7 to address [GHSA-vh45-f885-3848](https://github.com/advisories/GHSA-vh45-f885-3848). Password cryptography is not used by this server, but the vulnerable transitive version is not retained.

Run `pnpm check` and `pnpm audit --prod` when updating dependencies. Review both upstream source and the published package: they can differ even when their package.json versions match. Do not accept an upstream update that silently reintroduces automatic credential login or arbitrary external redirects.
