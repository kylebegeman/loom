# L45: Fork lint gate

Status: Ready to build

Approved by Kyle on 2026-10-10.

`scripts/fork/loom.sh check` lints every fork-owned path, so a lint error stops the check the
same way a failing test does. Today ten lint errors sit in fork code unnoticed, because nothing
the fork runs lints it: upstream's CI lint job (`vp check`) does not gate the fork, and
`loom.sh check` runs seams, tests, the web build and typechecks only
(`scripts/fork/loom.sh:139-159`). This packet fixes those ten errors and adds the gate.

## Scope

- In:
  - Fix the ten current errors in fork web code (three rules; see TECHNICAL.md).
  - A `check_fork_lint` step in `run_checks`, over every fork-owned source path, with
    `--deny-warnings`.
  - A focused test for the path list and failure propagation in `scripts/fork/loom.test.ts`.
  - FORK.md and CONVENTIONS.md lines that describe `loom.sh check`.
- Out:
  - Formatting checks (`vp fmt --check`); a later, separate gate if wanted.
  - Linting upstream files that carry fork seams: their lint belongs to upstream.
  - Changing lint rules or adding disable comments.
  - Making upstream's `ci.yml` run on the fork.

This packet touches fork features beyond the 3D panel: panel picker (L12), PCB preview (L24),
code graph (L26), thread inspector (L04), Device QA (L09) and file outline (L05). Each fix is a
class name or a resize observer swap with no behaviour change beyond the rule's intent.

## Surfaces

Maintainer tooling, plus small visual fixes on web and desktop: focus rings drawn inside their
element, two PCB views that resize in the same frame, and a panel picker that no longer shifts
sideways when its scrollbar appears. Mobile is untouched. No server or wire change.

## Extension points used

None.

## Packet seams

None. `scripts/fork/loom.sh`, `scripts/fork/loom.test.ts`, FORK.md and every fixed file are
fork-owned. See [SEAMS.md](./SEAMS.md).

## New dependencies

None. `vp lint` and its plugins are already in the workspace.

## Relationship to other follow-up packets

Independent. Once it lands, every other packet's `loom.sh check` also lints, so packets that land
later must be lint-clean on fork paths, which CONVENTIONS.md already asks for ("lint is clean on
changed files", `docs/fork/packets/CONVENTIONS.md:250`). Packets in flight when L45 lands
should rebase and run `loom.sh check` once.

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
