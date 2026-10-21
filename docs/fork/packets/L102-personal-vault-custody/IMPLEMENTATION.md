# L102 implementation packet

## Starting conditions

Read the [umbrella](../LOOM-PERSONAL-VAULT.md), conventions and current `ext-vault` before code.
Keep development Vault intact. Use synthetic data only while custody is unproven. The proposed
personal extension is not implemented; inspect available primitives before choosing work.

## Ordered work

1. Record supported threat/topology assumptions for Mac and iPhone. Demonstrate why the
   proposed custodian and browser cannot be controlled by the full-access agent principal.
   Keep local status UI and fixture work usable while a topology remains unsupported.
2. Compare maintained engine/format candidates using KDBX 4 first. Record exact hierarchy,
   KDF defaults, platform bindings, licenses, maintenance and export/recovery compatibility.
   Present the concrete dependency choice before adding a production dependency.
3. Define shared versioned non-secret capability/error schemas and trusted local operation
   shapes. Separate owner identity from environment/login/grants. Implement unsupported
   adapters first; do not expose master keys, recovery material or reveal RPCs.
4. Implement engine-backed fixture create/open/save/lock with authenticated encrypted metadata,
   atomic replacement, bounded reads and corrupt/unknown-version rejection. Add crash and
   format-compatibility coverage before real records.
5. Add the reviewed native unlock/presence adapter, exact caller authentication and local
   lock policy. Prove lock wins races with delayed presence, session suspend and device
   revocation. Inspect/cancel pending operations without granting unlock authority.
6. Add device admission, explicit approval, cancellation/expiry and monotonic revocation.
   A disconnected device must see stale trust honestly; it cannot overwrite current trust
   merely by reconnecting with an old encrypted snapshot.
7. Add recovery bootstrap and a clean-device recovery exercise using the same selected
   engine. Inspect/cancel before promotion, reconcile revoked devices and test loss of each
   factor. State the unrecoverable case explicitly.
8. Wire only coarse availability into existing Loom settings/palette. Keep trusted UI
   separately verifiable from an agent-controlled served bundle. List unsupported Android,
   Windows, Linux and general web states rather than routing unlock to the server.
9. Run focused suites and native checks from the actual selected target manifest. Obtain
   independent security review before critical personal custody, record unresolved findings
   and publish accurate recovery instructions. No live migration/deployment follows from
   completing local work.

## Acceptance

Fixture recovery and lock/revoke races are proven; the exact OS isolation claim is supported
by adversarial evidence; keys and private metadata never enter Loom server/RPC/MCP/prompt
state. A supported-client label requires the actual signed/native topology, not a mock. All
other clients expose a clear unsupported state. These remain proposed acceptance criteria,
not claims that this design packet implements custody.
