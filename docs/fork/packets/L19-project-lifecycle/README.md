# L19: Project lifecycle

Status: lanes, resource leases, selected-computer project preparation and linked machine
handoff are implemented. Managed primary-checkout release and reopen are implemented locally.

A lane owns disposable output and leased resources for a checkout. The connected computer
owns its project records, conversation history, providers and credentials. The checkout can
be released when publication and local-data checks prove it safe, while those durable records
remain available.

## Scope

- Capped lane space, storage pressure handling, agent cleanup tools and optional shell routing.
- Owned processes, ports, simulators, labelled Docker resources and machine-wide build slots.
- Create, clone or open a project on a selected connected computer; reuse its existing checkout
  and run repeatable project setup when preparing work.
- Opt-in release of published managed worktrees and primary clones, with local recovery and
  automatic restoration on explicit use. Folders opened manually are not adopted for deletion.
- Move work by preparing a published revision on another computer and creating a linked
  continuation. The original conversation remains on its host.
- Per-host GitHub setup and provider readiness. Connecting a host does not copy credentials.

Cloud provisioning, live file synchronization, complete thread-history migration and a new
runner system are outside this packet. Publication uses the existing Git workflow; cleanup
and handoff verify commits already pushed rather than making commits or pushes themselves.

## Surfaces

Web and desktop expose lane and checkout storage policies. Web and native mobile can select
computers for project creation and continuation. Mobile turns use the same server preparation
and restoration paths. Local, tailnet and relay connections retain the same host ownership.
Capabilities gate lanes, managed checkout cleanup and handoff independently.

## Extension points and seams

The lane and handoff services use the existing fork registries. Checkout ownership,
restoration and cleanup also have narrow integrations in upstream clone, project, Git,
filesystem, terminal and provider-start services. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): daily workflow and product boundaries.
- [TECHNICAL.md](./TECHNICAL.md): ownership, recovery and host constraints.
- [SEAMS.md](./SEAMS.md): merge constraints.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): implementation boundaries to preserve.
- [TESTING.md](./TESTING.md): focused verification.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
