# L106 references

## Existing Loom source, verified at `36de6bbd1d`

- `apps/server/src/fork/vault/VaultCore.ts:104` and `:149`: server reads and reveals development values. A new label does not change custody.
- `apps/server/src/fork/vault/VaultPolicy.ts:37`: current grant evaluation, useful for scope semantics but not host isolation.
- `apps/server/src/fork/vault/VaultTestAccountWorkloads.ts:239` and `:261`: revalidation around authorization waits; delivery explicitly disabled in this path.
- `apps/server/src/mcp/toolkits/preview/handlers.ts:230` and `tools.ts:267`: evaluate can return page data and mutate state. Masked inputs are not secret isolation.
- `apps/server/src/fork/vault/OperationJournal.ts:25`: development operation reservation/unknown-state precedent, not a personal authority ledger.
- `packages/provider-core/src/fork/vaultInstructions.ts:4`: shared provider guidance and scheduled-agent/command-job distinction.
- [L84](../L84-vault-test-accounts/), [L85](../L85-vault-delivery/), [L86](../L86-vault-approvals/): dedicated test identities, common delivery and request lifecycle overlap. Keep their development credential custody separate.
- [Personal Vault](../LOOM-PERSONAL-VAULT.md): proposed personal boundary and priority decisions. This is a new proposal, not an old Loom P/F selection or a claim to have inspected the old repository.

## Official references

- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html): reduced token authority, replay and redirect risks.
- [OAuth 2.0 Rich Authorization Requests, RFC 9396](https://www.rfc-editor.org/rfc/rfc9396.html): explicit operation details where a provider supports them; not a general website capability.
- [WebDriver specification](https://www.w3.org/TR/webdriver2/): browser script execution and page access explain why arbitrary session control cannot mean read-only.
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security): process and IPC controls to evaluate; these do not prove isolation from an unrestricted same-user agent.

Links are reference targets, not network-verified in this task. No external code/assets copied and no new dependency selected.
