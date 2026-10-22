# Loom Vault product and packet index

Status: **Implementation authorized**. Kyle selected all 16 packets for implementation on
2026-10-17 and chose self-hosted OpenBao. L79/shared encrypted records, L80 public-key enrollment,
L85 hosted run access, L82 mediated/terminal SSH/Git and key/trust management, L81/L78/L73 grants,
inspection and server readiness, and L74/L76 reference search, project profiles, explicit launch attachments, scheduled outcome recovery, portable SSH/Git/GitHub requirements, retained-selection retirement and L83 dedicated GitHub/mediated GH access with named project bindings, explicit terminal gh/Git HTTPS and live readiness, and L84 development account collections with session-owned and authenticated run-owned reservations are in progress; the other packets are selected and queued. No deployment is authorized. The V01 to V16 identifiers remain stable
from the brainstorm; L73 to L88 are their repository packet IDs.

Loom Vault is a development resource system for credentials, accounts and other secure records.
It separates agent/development access from Kyle's personal 1Password vault. Dorothy, other
computers, remote workers and CI should use authorized development identities without
repeated personal key approvals. Kyle's VPS, begam.in services and Loom platform are available
hosting/integration options, not infrastructure to replace or deploy without review.

## Product scope and confirmed intent

- All sixteen outcomes below are retained, including the core storage, broker and policy systems.
- Manage through web, desktop and mobile; use through Loom, CLI, MCP and enrolled runners.
- Store and manage dedicated SSH keys, service connections, test accounts and extensible secure records.
- Prefer resource-name selection and reusable references over copied values. Profiles are optional.
- Personal environments can explicitly enable owner-trusted inspect and brokered use once; shared
  and legacy environments retain restricted grants. Credential availability never authorizes a task.
- Keep personal credentials separate. Imports and configuration changes are explicit and reviewable.
- The implementation packets preserve the selected scope. OpenBao is selected; custody,
  platform ownership and production rollout decisions remain explicit.

## Packet catalog

Each folder contains README, PRODUCT, TECHNICAL, SEAMS, IMPLEMENTATION, TESTING and REFERENCES.
Complexity and impact are the brainstorm estimates, not delivery dates. L79, L80, L81, L78, L73, L85, L82, L74, L76, L77, L75, L86 and L83 have local milestones; L84 now adds development account collections, scoped agent reservations and durable lease cleanup. All remain partial; the other packets are selected and queued.

### Minor Features & Improvements

| Idea | Packet and complete outcome                                                    | Complexity | Impact |
| ---- | ------------------------------------------------------------------------------ | ---------- | ------ |
| V01  | [L73 Headless readiness checks](./L73-vault-readiness/)                        | Medium     | High   |
| V02  | [L74 Searchable credential references everywhere](./L74-vault-references/)     | Medium     | High   |
| V03  | [L75 Guided migration from personal credential stores](./L75-vault-migration/) | Medium     | High   |
| V04  | [L76 Project environment profiles](./L76-vault-profiles/)                      | Medium     | High   |
| V05  | [L77 Credential health and maintenance inbox](./L77-vault-health/)             | Medium     | High   |
| V06  | [L78 Explain access and preview changes](./L78-vault-access-inspector/)        | Medium     | High   |

### Major Features, Systems & Refactors

| Idea | Packet and complete outcome                                                             | Complexity | Impact           |
| ---- | --------------------------------------------------------------------------------------- | ---------- | ---------------- |
| V07  | [L79 Encrypted Vault and self-hosted control plane](./L79-vault-core/)                  | Large      | Transformational |
| V08  | [L80 Enrolled machines and headless brokers](./L80-vault-brokers/)                      | Large      | Transformational |
| V09  | [L81 Agent identities and persistent access grants](./L81-vault-grants/)                | Large      | Transformational |
| V10  | [L82 SSH key management and Loom SSH agent](./L82-vault-ssh/)                           | Large      | High             |
| V11  | [L83 Developer service accounts and authentication connectors](./L83-vault-connectors/) | Large      | High             |
| V12  | [L84 Test account collections and provisioning](./L84-vault-test-accounts/)             | Massive    | Transformational |
| V13  | [L85 Credential delivery API, CLI, and runner integrations](./L85-vault-delivery/)      | Large      | Transformational |
| V14  | [L86 Remote approvals and temporary access](./L86-vault-approvals/)                     | Large      | High             |
| V15  | [L87 Credential lifecycle automation and short-lived access](./L87-vault-lifecycle/)    | Massive    | High             |
| V16  | [L88 Backup, recovery, and portability](./L88-vault-recovery/)                          | Large      | High             |

Read the [shared foundation proposal](./LOOM-VAULT-FOUNDATION.md) for technical boundaries,
identity, key custody, recovery and backend evaluation. The [HTML overview](./LOOM-VAULT.html)
is a navigable companion; packet Markdown remains the authoritative design record.

## Proposed platform shape

A central authority hosted on the VPS manages Vault records, policy and durable history. Local
brokers on enrolled execution hosts authenticate workloads and deliver authorized access to
tools. Loom clients and a possible begam.in management surface speak to that authority through
versioned service interfaces. They are not holders of all machine credentials.

This is the recommended direction for review. It is not an assertion that the current platform
already exposes the required auth, key service, notification or deployment APIs. Inspect those
contracts in their owning project before selecting an integration. A domain name or existing
login is not sufficient proof of Vault authorization.

A backend adapter isolates the selected self-hosted OpenBao engine. Kyle chose OpenBao over
Loom-native encrypted storage; a disposable OpenBao 2.7.1 proof passed CAS, encrypted persistence
and clean restore. Keep Loom-specific accounts, profiles,
runner ergonomics and permission semantics out of backend-specific clients.

## Capability dependencies and packet independence

The `ext-vault` boundary has implemented encrypted-record contracts and services. Environment
access mode, restricted thread/project grants, bounded decision history, explanations and
server-context readiness share one policy boundary. Reviewed host enrollment and online
heartbeat presence are implemented. Platform identity, full audit, workload channels and
delivery target interfaces remain subject to their packet designs. See the explicit proposal in
[EXTENSION-POINTS.md](./EXTENSION-POINTS.md#loom-vault-foundation-ext-vault). Promote each
implemented shared contract into that specification as it becomes usable. A packet can supply a
missing approved portion of the shared extension in a separate commit; it must not import
another feature packet's internals or assume its UI exists.

| Shared capability                                       | Primary design owner    | Consumers and graceful absence                                                                |
| ------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| Encrypted records, stable references, baseline recovery | V07 / L79               | All Vault features; no backend means clearly unavailable, never fallback to personal secrets. |
| Enrolled host and workload channels                     | V08 / L80               | Readiness, SSH, delivery and automation; absent broker means no unattended-use claim.         |
| Access mode, grants, principal attestation and decision audit   | V09 / L81               | All execution and explanation paths; absence denies use.                                      |
| Purpose-specific delivery adapters                      | V13 / L85               | SSH, connectors and account sessions; unsupported modes fail before launch.                   |
| Provider connection/issuance adapters                   | V11 / L83 and V15 / L87 | Checks, health and renewal; report each adapter's capability rather than assuming support.    |
| Durable requests and account leases                     | V14 / L86 and V12 / L84 | Approval and QA consumers; existing grants/stored accounts work without automation UI.        |

The owner column identifies who develops the design, not a compulsory sequence of sixteen
feature builds. Each packet's optional adapters must be independently installable or unavailable
with an honest explanation. There is no speculative requirement to build a plugin framework.

## Delivery groups

These groups preserve all selected outcomes. All groups are selected; IMPLEMENT-NOW.md records progress.

1. **Establish the foundation:** decide engine, identity, custody and recovery together; build the
   approved minimum record, broker and grant interfaces. Prove baseline restore before real secrets.
2. **Resolve Dorothy's current workflow:** SSH keys, GitHub connection, runner delivery, readiness
   and reviewed migration. Prove repeated operations and service restart without 1Password prompts.
3. **Make daily use coherent:** references, profiles, health, explanations and remote exceptions.
4. **Expand managed resources:** test-account pools/provisioning and short-lived issuance/rotation.
5. **Complete recovery operations:** polished backup management, recovery exercises and portability.
   This expands the baseline recovery required in group 1; backups are not deferred to this group.

The first working proof uses disposable accounts and SSH hosts. A local green test is not
permission to migrate personal keys, register a public endpoint or deploy on the live VPS.

## Design decisions before building

| ID  | Choice and evidence needed                                                                                           | Design owner  | Status                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| D1  | Select backend after a disposable proof of encryption, APIs, policy fit, backup/restore, license and operating cost. | L79           | Decided: OpenBao, Kyle 2026-10-17; 2.7.1 synthetic proof passed                    |
| D2  | Decide decryption/key custody, unattended unlock and recovery bootstrap for every supported host mode.               | L79, L80, L88 | Open                                                                               |
| D3  | Verify platform identity and session contracts; choose Vault owner/admin mapping and service-to-service auth.        | L79, L81      | Personal environment declaration; platform multi-owner mapping remains open             |
| D4  | Choose the initial macOS/Linux/Windows broker matrix, service lifecycle and workload authentication.                 | L80, L85      | User-service matrix implemented locally; real-host acceptance and other modes open |
| D5  | Decide offline support and maximum lease/revocation delay. Proposed initial default: online-only new use.            | L80, L81      | Open                                                                               |
| D6  | Set grant scopes, precedence, delegation and the boundary requiring OS/container isolation.                          | L81           | Personal opt-in and restricted grants selected; platform/isolation open                                     |
| D7  | Choose SSH destination enforcement, key formats, agent transports and forwarding policy.                             | L82           | Host-bound mediated/terminal POSIX resolved; other transports open                 |
| D8  | Select initial service/account adapters and account ownership, starting with GitHub and a real test application.     | L83, L84, L87 | App/token implemented locally; broader onboarding/adapters open                    |
| D9  | Set recovery ownership, separate key custody, backup destination/retention and recovery time/data-loss goals.        | L79, L88      | Open                                                                               |

Each PRODUCT.md adds packet-specific choices. A recommendation is not an answer from Kyle.
Record decided choices, concrete contracts and precise seams as implementation advances. The
current foundation uses OpenBao KV v2 with no new application dependency or SQL migration. It
uses the existing environment session for management and an operator-provisioned service token
file for backend access. Personal mode is an explicit environment declaration, not verified
platform multi-owner identity. These are development defaults, not completed platform ownership,
workload delivery or production unseal/recovery decisions.

## What success looks like

On a disposable equivalent of Dorothy, enroll the machine, create dedicated development access,
enable personal access or configure restricted grants, then perform GitHub and SSH work through
Pi and another installed runner. Restart both broker and Loom service and repeat from a mobile
client without personal key-manager approval. Disable personal access or revoke the applicable
grants, inspect the explanation and prove that subsequent online use is denied when no
independent authorization remains. Test an outage according to the chosen offline policy and
restore the Vault on a clean host.

Test accounts can then be reserved by parallel QA workers, reset or quarantined safely, and
released without mixing personal identities or leaking sessions into conversations. Rotation
and recovery must report partial external outcomes rather than claim universal revocation.

## Priorities retained from the brainstorm

**Highest ROI:** headless broker plus Loom SSH agent (V08/V10), GitHub integration (V11),
readiness (V01) and reusable environment profiles (V04), on sufficient storage/policy foundations.

**Long-term value:** encrypted shared Vault, broker and grants (V07/V08/V09); test-account
provisioning (V12); common delivery (V13); lifecycle automation (V15); recovery/portability (V16).

**Noticeable early slices:** readiness diagnostics, an inventory of personal credential
dependencies, stable references for existing secret settings and consolidated expiry warnings.
Early slices do not substitute for completing the selected packet scope.
