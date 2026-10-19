# L75 implementation

Status: **In progress**. Kyle authorized all sixteen packets; this local milestone is working.
The complete PRODUCT scope stays selected. See [TESTING.md](./TESTING.md) for exact evidence.

## Delivered

- CAS and idempotent environment/project-local profile registry, active default and archive/restore.
- Web/native create/edit/clone, key picker, unbind, review and incomplete configuration repair.
- Authenticated MCP/CLI project listing, durable run resolution and named hosted SSH/Git execution.
- Current policy/key/host checks, project/provider/run attestation and archive guard at signing.

## Remaining

1. Add reviewed profile selection and preflight to interactive and scheduled task launch.
2. Separate portable requirement declarations from local bindings; support credential/account kinds as adapters arrive.
3. Design Library sharing and retained run-selection inspection/cleanup without publishing secret bindings.

## Completion gate

Do not mark Done until all selected consumers, reverse actions, connection modes and supported
surfaces work. Production rollout, live credential registration and personal migration are
separate actions. Post-merge full rehearsal belongs to Kyle's authorized landing workflow.
