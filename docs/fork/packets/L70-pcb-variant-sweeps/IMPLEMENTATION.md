# L70 implementation

Implemented locally with three code milestones: shared render-cache commit extraction, isolated
host candidates and agent proposals, then the client workbench and integration.

Candidate exports reuse `runRender`; no `makeVariantBuilds` factory was introduced. L55's pure
board stats and L69's existing thumbnail limit are reused. Sweep limits remain 8 and 24 saved.
The optional timing experiment did not run because `tsci` is unavailable.

The complete Parameters flow includes typed one/two-axis sweeps, automatic rendering when
allowed, sequential batches and cancellation, saved grid/table previews, sorting, comparison,
review promotion, agent proposals and panel rendering. Tests cover host isolation and failure
paths plus actual client state/command interactions with mocked export and image boundaries.

See [TESTING.md](./TESTING.md) for focused evidence and pending real-client, real-CAD and remote
verification. No dependencies, upstream seams or new keyboard bindings were added.
