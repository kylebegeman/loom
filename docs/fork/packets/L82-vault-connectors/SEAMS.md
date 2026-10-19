# L82 seams

## Actual integration

All source changes live in existing fork-owned contracts, server, client-runtime, provider
instruction and web/native settings directories. ForkLayer, ForkRuntime, RPC authorization,
capabilities, settings registry, MCP toolkit and CLI dispatch reuse existing extension points.
The separately inferred GitHub RPC group bounds server handler union inference.

No upstream-owned file, dependency manifest, lockfile or SQL migration is changed. No new
FORK.md seam row or seams.tsv entry is needed. The provider instruction extension was already
marked and is reused through its fork-owned string.

## Future review areas

Ordinary Git HTTPS/helper routing and explicit project/default selection must review existing
GitHubHostSetup/GitHubCredentials, retain ambient precedence for unmigrated projects and list
any actual marked upstream integration before adding it. Other packets consume the shared
contract/service boundary rather than these client components.

## Merge verification

Read-only merge previews and baseline differences are recorded in [TESTING.md](./TESTING.md).
A baseline conflict is not a clean merge claim; no working-tree merge or deployment is implied.
