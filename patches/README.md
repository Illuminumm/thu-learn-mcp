# thu-learn-lib compatibility patch

Target: the npm release `thu-learn-lib@4.2.6`, not its moving Git default branch.

The published package keeps its request implementation and cookie jar private. It cannot import a browser session through its public configuration. This patch adds `HelperConfig.fetch?: Fetch` and assigns the injected request implementation in the constructor. The MCP application supplies the domain-restricted, session-aware transport; upstream request paths and parsers stay unchanged.

pnpm applies `thu-learn-lib@4.2.6.patch` during installation using the entry in `pnpm-workspace.yaml`. Keep the patch's LF line endings and lockfile hash intact. Do not format the patch as TypeScript or regenerate it from a different upstream version.

On upgrades, inspect the actual npm artifact and types first. Remove this patch once an equivalent supported injection interface is available and passes the adapter/authentication tests. See [architecture](../docs/architecture.md) for the public API differences already observed.

The upstream library is MIT licensed, copyright (c) 2019–2022 Harry Chen. Its license is retained in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md); the compatibility additions are covered by this repository's MIT license.
