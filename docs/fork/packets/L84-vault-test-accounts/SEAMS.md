# L84 seams

Product implementation is fork-owned. Existing contracts/RPC group, scope maps, runtime construction,
capability list, client commands, web settings/palette and mobile Vault settings register the new
service without an upstream-owned product seam. The fixture harness also uses the existing
`dev-fixtures` seam in `apps/server/scripts/seed-dev-db.ts`: marker JSON is staged before database
publication and renamed atomically, with temporary cleanup on ordinary failure. Its markers are
listed in FORK.md and the seam manifest.
No package dependency, SQL migration, Library service or provider adapter is changed.

The independent registry uses the reserved `profiles/_test_accounts/registry-v1` branch inside
the current environment namespace. VaultProfiles documents the reservation; cleanup regression
coverage protects it and the operation journal while retiring a project's run selection.

No browser profile, device session, private-input or credential delivery hook is added. Values
remain in existing VaultCore Account records. Test fixtures and screenshots are evidence only;
no personal accounts, production policy, credentials or QA screenshots are committed.

Implementation base: fork main `4070ef99a2`, which includes the PR #35 upstream integration.

The agent slice adds only fork-owned service/MCP registrations in ForkLayer, ForkRuntime and the
fork MCP index. Cleanup writes the same registry via CAS; no orchestration event/schema seam,
Library contract, OpenBao policy/path or access-policy/journal format change is introduced.
