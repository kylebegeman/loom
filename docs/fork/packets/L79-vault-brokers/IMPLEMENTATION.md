# L79 implementation plan

Status: In progress. Enrollment, approval, disable, foreground renewal and managed macOS/Linux
user-service lifecycle/recovery are implemented locally.
The sequence below retains the full packet outcome;
see README for delivered progress and remaining work.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Remaining delivery work

Signed machine/workload channels and mediated SSH/Git operations are implemented in L84/L81;
they do not provide an ordinary terminal agent socket or OS isolation. The managed lifecycle
adds a launchd GUI-user/systemd-user service and honest startup, unlock and presence diagnostics.
Verify actual login/logout, crash/reboot and remote reconnect on chosen macOS/Linux/Pi hosts,
then extend the matrix only with evidence. Decide encrypted local custody, pre-login macOS
service support and Windows support separately. Keep enrollment presence separate from current
credential authority. No production service or installation has been changed.

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
