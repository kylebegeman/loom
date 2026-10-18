# L76 seams

## Extension points

Existing fork extension points are reused where present. Proposed `ext-vault` is specified in
[LOOM-VAULT-FOUNDATION.md](../LOOM-VAULT-FOUNDATION.md); its implemented record boundary is specified in EXTENSION-POINTS.md and
future portions must be reconciled with [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) before use.

## Packet integration review

Register background work in the fork service layer. Existing scheduler turns are not required for health checks; avoid generating agent conversations for maintenance.

These are candidate integration areas, not an approved list of upstream edits. Final source
locations, marked lines and any generated files must be enumerated after the extension and
backend decisions. Keep business logic in fork-owned paths.

## Actual seams and merge status

None: this packet currently adds documentation only. No FORK.md seam-table rows or seam
manifest entries are required. No code merge rehearsal has been run or claimed. Future
implementation records exact marked edits, justified exceptions and the reviewed nightly tag.
