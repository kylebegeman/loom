# L76 implementation

Status: **In progress**. Kyle authorized all sixteen packets; this local milestone is working.
The complete PRODUCT scope stays selected. See [TESTING.md](./TESTING.md) for exact evidence.

## Delivered

- CAS and idempotent environment/project-local profile registry, active default and archive/restore.
- Web/native create/edit/clone, key picker, unbind, review and incomplete configuration repair.
- Authenticated MCP/CLI project listing, durable run resolution and named hosted SSH/Git execution and dedicated GitHub execution.
- Current policy/key/host checks, project/provider/run attestation and archive guard at signing.
- Exact scheduled-message outcome projection with web/native review and explicit retry.
- GitHub connection/repository selection, configuration/grant preflight and guarded named GH execution.
- Versioned portable requirement import/export, empty local bindings and project-scoped CLI/MCP.
- Paged retained-selection inspection, manual terminal-run retirement and durable no-reselection tombstones.

## Remaining

1. Add credential/account kinds as their delivery/connector adapters arrive; current declarations support SSH/Git/GitHub.
2. Design Library publication and project-file discovery for portable declarations without secret bindings.
3. Choose opt-in automatic retention and recovery policy, including backend version-history handling.

## Completion gate

Do not mark Done until all selected consumers, reverse actions, connection modes and supported
surfaces work. Production rollout, live credential registration and personal migration are
separate actions. Post-merge full rehearsal belongs to Kyle's authorized landing workflow.
