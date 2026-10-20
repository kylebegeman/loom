# L100: Bots anywhere

Status: Selected; queued.

Library bots. Kyle shares a bot to the Loom Library (loom.begam.in) once, and every computer
enrolled in that Library gets it, with edits flowing through the Library. A run, a batch or a
pipeline step can then run on a chosen computer: Dorothy, a Mini worker that runs a Loom server,
or the VPS. "Run a batch of 50 on the Mini while Dorothy stays responsive." Before a run is sent,
the target's readiness is shown: online, provider signed in, project copy present, required tools
(L73), and Vault slots bound to that computer's own Vault items (L74). Secrets are never copied
between computers.

**Local implementation only.** This packet builds and tests the Library side and the computer
side in this repository, against a local Library authority. Nothing is deployed to the Library
VPS, and no computer's settings are changed, without Kyle's approval. Until a Library that
advertises `bots-anywhere` is running, every computer behaves exactly as it does with L89 to L99.

B12 | Complexity: Large-Massive | Impact: Transformational | Depends on: L89; L93 and L99 for
remote batches and steps; Library enrollment, the directory, L73 and L74 as they exist today

## Scope

- In: sharing a bot to the Library and unsharing it; pulling Library bots onto every enrolled
  computer as linked local definitions; edits through the Library with revision checks; Vault
  slots bound per computer; remote runs through a leased request and result mailbox on the
  Library; target readiness from the directory and target status reports; a per-computer switch
  to accept remote runs with a runtime mode ceiling; batches and pipeline steps with a target;
  MCP tools; recovery on both sides.
- Out: deploying the Library or any computer; installing a Loom server on a Mini; direct
  computer-to-computer connections; moving a running run between computers; syncing run history
  to the Library (results return to the requester only); mobile.

## Surfaces

Web and desktop: Share to Library, a "From the Library" badge, a target picker on Run, Run on
many and pipeline steps, a Vault slot editor, and a Remote runs setting. Mobile: nothing new.
Remote: RPC plus fork HTTP routes on the Library authority. Gated on `bots-anywhere` on the
computer and on the Library's advertised features.

## Extension points used

None new (L89's): `ext-core`, persistence, background work under `forkParked`, `ext-mcp`. Fork
HTTP routes are registered in `ForkLayer` as the Library and pages routes already are. The
existing `ext-vault-preflight` guard checks Vault links at run time. Capability sub-feature
`bots-anywhere`.

## Packet seams

None. See [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
