# L19: Project lifecycle

Status: lanes, resource leases, selected-computer project preparation, linked machine
handoff, reviewed existing-project adoption, primary-folder retention and release/reopen are implemented.

A lane owns disposable output and leased resources for a checkout. The connected computer
owns its project records, conversation history, providers and credentials. The checkout can
be released when publication and local-data checks prove it safe, while those durable records
remain available.

## Scope

- Capped lane space, storage pressure handling, agent cleanup tools and optional shell routing.
- Owned processes, ports, simulators, labelled Docker resources and machine-wide build slots.
- Create, clone or open a project on a selected connected computer; reuse its existing checkout
  and run repeatable project setup when preparing work.
- Opt-in release of published managed worktrees and primary folders, with local recovery and
  automatic restoration on explicit use. Existing repositories require explicit reviewed
  adoption; opening a folder never grants cleanup ownership. Per-project primary-folder
  retention overrides computer defaults without changing worktree cleanup.
- Move work by preparing a published revision on another computer and creating a linked
  continuation. The original conversation remains on its host.
- Per-host GitHub setup and provider readiness. Connecting a host does not copy credentials.

Cloud provisioning, live file synchronization, complete thread-history migration and a new
runner system are outside this packet. Publication uses the existing Git workflow; cleanup
and handoff verify commits already pushed rather than making commits or pushes themselves.

## Surfaces

Web and desktop expose lane and computer cleanup policies. Web, desktop and native mobile
expose reviewed primary-folder adoption and retention, and can select computers for project
creation and continuation. Mobile turns use the same server preparation and restoration paths.
Local, tailnet and relay connections retain the same host ownership. Capabilities gate lanes,
checkout management, cleanup and handoff independently.

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
