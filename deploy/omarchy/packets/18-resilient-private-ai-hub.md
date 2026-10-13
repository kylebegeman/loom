# 18. Resilient private AI hub

Improve private AI availability while Switchboard remains authoritative for every route.

Status: **verification_pending**. Complexity: **Large**. Impact: **High**.

Owner: LoomOS with existing app/hub owners. Dependencies: [#4](04-guided-connections.md), [#5](05-capability-aware-availability.md).

## Scope

- Explain hub readiness, account constraints and model eligibility using centralized cached status.
- Add explicitly supported wake/readiness controls and evaluate secondary capacity when useful.
- Explore local-model routes only through Switchboard, after hardware/task-quality measurements.

## Acceptance

- Verify asleep/offline/constrained/ineligible states without polling providers from each client.
- Check wake support, cancellation, timeout and route ownership with synthetic fixtures.
- Secondary/offline routing preserves existing subscription/client restrictions and has no direct-provider fallback.

## Delivery

Local preparation and focused checks first. Workstation rollout/native acceptance when reachable; secure lock and necessary local authentication remain normal user flows.

## Evidence

- Switchboard committed source fe0a29c5ca8ea4e21da14e2304a6efe457f6236a passes both typechecks and 588 tests across 81 files. Central cached readiness enforces client credit/model restrictions; portable waiting is bounded and cancellable, reviewed wake is origin-bound, and recovery never starts or replays inference.
- Dorothy controller release 5a10e98d5884c45a37d8da7d3ebb9355aa377f65831be92d4312eee7e6d69cc0 is activated and verified over private Tailscale HTTPS. Live cached reads confirm 33 personal models, two eligible GPT models each for Office and Atlas, app Claude refusal and exact provider/model mismatch reporting. Native proxy PID 60768 and network gateway PID 23301 are unchanged; their services were not restarted.
- Physical wake remains uncommissioned: Dorothy uses Wi-Fi and has no active IPv4 Ethernet interface; no sleep/wake experiment was performed on the active hub. Secondary hubs and local-model routes remain uncommissioned without hardware/task-quality evidence.
- Prepared immutable pack 20261013.49 with 38 members, SHA256 c0fb729d18fa78f82831c855befc674af545dc7bd1b4ca21325656f038754625, and matching recovery recipe 9854fbfc7c2bd9eb2270bb56daae91c222ae6eb491c72e488de7c7e753087945. All pack bytes match committed OS source 2c99e20961. The full pack gate passes 368 tests; 27 focused AI/hub/health tests and scoped lint pass. The regression test proves literal prompt text after -- cannot change the model precheck. Supported verifyKit passes; only Switchboard changes, while Loom, Office, Atlas and server inventories remain identical to the retained .47 kit. Portable committed-source commands also pass real cached HTTPS reads and refuse uncommissioned wake without credentials or inference.
- LoomOS native hub view, launcher/menu actions, status explanations and provider/model-aware Ask AI guards are implemented. The Linux portable client is pinned to committed source. Workstation is offline in Tailscale and SSH times out; installation, native acceptance and packet closeout remain pending. Existing installed pack 20261013.47 and rollback kits are retained.
