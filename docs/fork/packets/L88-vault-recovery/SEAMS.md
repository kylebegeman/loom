# L88 seams

## Extension points

Existing fork extension points are reused where present. Proposed `ext-vault` is specified in
[LOOM-VAULT-FOUNDATION.md](../LOOM-VAULT-FOUNDATION.md); its implemented record boundary is specified in EXTENSION-POINTS.md and
future portions must be reconciled with [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) before use.

## Packet integration review

Use backend export interfaces and fork CLI/UI registration. Do not fold Vault recovery into the upstream SQLite doctor command without an explicit reviewed integration.

These are candidate integration areas, not an approved list of upstream edits. Final source
locations, marked lines and any generated files must be enumerated after the extension and
backend decisions. Keep business logic in fork-owned paths.

## Actual seams and merge status

`apps/server/src/fork/vault/cli.ts` registers the fork-owned recovery command and service.
All files remain under the existing fork-owned boundary. No upstream edit, new dependency,
OpenBao policy/path or access-policy/journal format change is introduced. No seam-manifest
entry is required. Landing and the post-merge rehearsal remain with the platform owner.
