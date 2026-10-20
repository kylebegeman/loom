# L83 references

Kyle selected this complete V11 idea for implementation on 2026-10-17 and subsequently selected
OpenBao. The dedicated App/token milestone extends parent `78c8d44b17`.

## Current implementation

- [Shared GitHub contract](../../../../packages/contracts/src/fork/vault-github.ts)
- [Connection service](../../../../apps/server/src/fork/vault/VaultGitHub.ts)
- [GitHub API adapter](../../../../apps/server/src/fork/vault/GitHubTransport.ts)
- [Isolated GH adapter](../../../../apps/server/src/fork/vault/GitHubCli.ts)
- [Authenticated agent tools](../../../../apps/server/src/fork/vault/github-mcp.ts)
- [Shared client commands](../../../../packages/client-runtime/src/fork/vault-github.ts)
- [Web management](../../../../apps/web/src/fork/vault/GitHubSettingsSection.tsx)
- [Native management](../../../../apps/mobile/src/fork/vault/GitHubSettingsSection.tsx)

## Integration boundaries and prior art

- [Existing GitHub host setup](../../../../apps/server/src/sourceControl/GitHubHostSetup.ts)
- [Existing GitHub credential resolution](../../../../packages/source-control-github/src/server/GitHubCredentials.ts)
- [GitHub App JWT documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [Installation token API](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
- [Token release API](https://docs.github.com/en/rest/apps/installations#revoke-an-installation-access-token)
- [Shared foundation](../LOOM-VAULT-FOUNDATION.md)
- [Extension points](../EXTENSION-POINTS.md#loom-vault-foundation-ext-vault)
- [Packet conventions](../CONVENTIONS.md)

Uses existing jose, Effect and Node tooling. No external code or new production dependency is
copied. Disposable provider/CLI test fixtures do not establish live GitHub acceptance.

- [GitHub profile integration](../../../../apps/server/src/fork/vault/VaultGitHubProfiles.test.ts)
- [Shared profile design](../L76-vault-profiles/TECHNICAL.md#github-profile-binding-and-mediated-execution)

- [Command-scoped terminal adapter](../../../../apps/server/src/fork/vault/GitHubTerminal.ts)
- [Supported command parser](../../../../apps/server/src/fork/vault/GitHubCommand.ts)
- [Terminal CLI boundary](../../../../apps/server/src/fork/vault/terminal-cli.ts)
