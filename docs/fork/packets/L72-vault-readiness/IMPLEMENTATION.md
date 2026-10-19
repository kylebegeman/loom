# L72 implementation

Status: **In progress**. Kyle authorized the complete packet. This local milestone implements
server-context readiness; it does not deploy a service or migrate personal credentials.

## Delivered

The local milestone checks OpenBao connectivity, authenticated thread liveness and up to
16 explicit item/action/destination requirements through the execution evaluator. Results name
the Loom server context, include repair guidance and expire after 60 seconds. Web/desktop and
mobile can cancel a pending check; RPC, CLI and MCP use the same bounded service.

Use/reveal/export requests and empty requirement sets report missing broker/delivery support.
The backend check does not prove item-write privileges. An allowed grant does not prove SSH,
GitHub authentication, host trust, provider tools or unattended launch readiness.

## Remaining

Implement enrolled broker/runner context probes, profile requirement discovery, harmless
SSH and additional provider checks plus broader network/host-trust classification. Explicit
GitHub API/GH CLI/Git HTTPS checks and profile launch/schedule guards are implemented local
milestones. Keep configuration preflight separate from external live checks. Durable long-running check operations are not
needed by the current bounded server check, but remain required for future external probes.

Use the complete PRODUCT target and shared extension contract when extending this milestone.
Keep thin transports and one execution evaluator. Checks and integrated evidence are in
[TESTING.md](./TESTING.md). No production rollout is implied by passing local verification.

GitHub readiness is delivered through the existing connector boundary; see its [technical contract](../L82-vault-connectors/TECHNICAL.md#github-terminal-routing-and-readiness).
