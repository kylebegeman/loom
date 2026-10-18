# L79 implementation plan

Status: In progress. Enrollment, approval, disable and foreground heartbeat renewal are implemented.
The sequence below retains the full packet outcome;
see README for delivered progress and remaining work.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Remaining delivery work

Implement workload attestation and a purpose-specific authenticated local channel before
connecting use grants to SSH/delivery. Select boot/unlock custody with real macOS logout and
Linux service evidence, then extend the supported matrix. Keep enrollment presence separate
from credential authority. Validate restart/outage/revocation across actual remote hosts.
No production service or installation has been changed.

## Steps

1. Choose service identity storage, local transport and OS-specific startup/unlock support at D2/D4.
2. Implement reviewed enrollment, renewable credentials, disable and crash recovery.
3. Implement authenticated workload channels and online-only lease acquisition first; test bounded offline behavior only if selected.
4. Expose machine readiness and operating runbooks across clients.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
