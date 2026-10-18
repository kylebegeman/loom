# L74 seams

## Extension points

Existing fork extension points are reused where present. Proposed `ext-vault` is specified in
[LOOM-VAULT-FOUNDATION.md](../LOOM-VAULT-FOUNDATION.md); it has no implementation commit and
must be approved and reconciled with [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) before use.

## Packet integration review

Inspect GitHubHostSetup and SSH configuration writers. Prefer explicit per-repository configuration; no global rewrite of personal SSH or Git defaults.

These are candidate integration areas, not an approved list of upstream edits. Final source
locations, marked lines and any generated files must be enumerated after the extension and
backend decisions. Keep business logic in fork-owned paths.

## Actual seams and merge status

None: this packet currently adds documentation only. No FORK.md seam-table rows or seam
manifest entries are required. No code merge rehearsal has been run or claimed. Future
implementation records exact marked edits, justified exceptions and the reviewed nightly tag.
