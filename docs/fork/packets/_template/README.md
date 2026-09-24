# Lxx: Packet title

Status: Not started. <!-- Not started | Designing | Ready to build | In progress | Done | Blocked: reason -->

One paragraph: what this packet adds for the user, in plain words.

## Scope

- In: the concrete behaviors this packet delivers.
- Out: what it deliberately leaves out, and which later packet or idea might cover it.

## Surfaces

Web and desktop: supported or not, and why. Mobile: supported or not; what an unsupported
surface shows. Remote: confirm it works over every connection mode.

## Extension points used

List each one from [EXTENSION-POINTS.md](../EXTENSION-POINTS.md) (for example `ext-core`,
`ext-panels`). Note which ones this packet may have to create.

## Packet seams

One line per upstream file this packet touches beyond extension points, or "None". Details
go in [SEAMS.md](./SEAMS.md).

## Documents

- [PRODUCT.md](./PRODUCT.md): what and why, for Kyle.
- [TECHNICAL.md](./TECHNICAL.md): the design.
- [SEAMS.md](./SEAMS.md): every upstream touch.
- [IMPLEMENTATION.md](./IMPLEMENTATION.md): ordered steps for the implementing agent.
- [TESTING.md](./TESTING.md): how it is proven.
- [REFERENCES.md](./REFERENCES.md): prior art and sources.
