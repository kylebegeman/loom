# L82 implementation plan

Status: In progress. Dedicated key/trust management, a signed mediated command and web/mobile
management with fixed authenticated connection tests are implemented.
The sequence below describes the full packet outcome;
see README for delivered progress and remaining work.

## Before starting

Read the packet index, conventions, shared Vault documents and every file in this packet.
Resolve its open product choices and relevant D gates, promote any required extension contract,
and refresh source/seam references against the chosen base. Kyle recorded implementation authorization in [IMPLEMENT-NOW.md](../IMPLEMENT-NOW.md). New production dependencies,
schema and live infrastructure changes still follow the repository's authorization rules.

## Next selected section

Client management is verified on web/iOS. The approved follow-up now provides automatic
workload setup/release through existing provider/task MCP connections and Git ref listing/fetch
with repository-specific grants. Project profiles and searchable references are implemented in L76/L74. The terminal-agent
section now provides explicit per-child ordinary SSH/Git routing, including clone/fetch/push,
with run-owned host-bound signing and live policy checks. The real CLI path is verified against
disposable OpenSSH/OpenBao. Pi/ACP terminal connections are recognized; automatic terminal
connection propagation for remaining native harnesses is the next proposed section. Imports,
additional algorithms, persistent shell attachment, Windows and production registration remain
pending. The narrower hosted Git tool continues to support ref listing/fetch.
No existing Git remote or personal 1Password configuration was changed.

## Steps

1. Settle supported key types, OS agent transports and enforceable destination controls.
2. Implement key lifecycle, agent protocol subset and authenticated signing dispatch.
3. Add explicit host-trust and public-key registration workflows with independently testable adapters.
4. Integrate Git and SSH consumers through workload launch configuration and verify restart behavior.

## Integration and completion

Register shared services and protected methods through existing fork extension points. Add
focused behavior tests from [TESTING.md](./TESTING.md), then integrate clients, agent tools and
user guidance under `docs/fork/user/`. Enumerate any real upstream changes in SEAMS.md,
FORK.md and the seam manifest in the same implementation commit.

The complete product outcome, reverse actions and declared surfaces must work before marking
Done. Record check results and remaining limits; follow the repository definition of done.
No live credential or production rollout is implied by a passing local implementation.
