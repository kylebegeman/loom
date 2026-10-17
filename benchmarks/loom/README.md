# Loom performance benchmarks

This suite measures code added by Loom above upstream T3. All production targets are under
`apps/server/src/fork/` or `apps/web/src/fork/`. It exercises the actual implementations,
including real SQLite transactions for Library history, without starting the application,
providers, browsers, external programs or production databases.

## Run and compare

From the repository root, with installed dependencies and the same Node version:

```sh
node benchmarks/loom/run.ts --output .t3/benchmarks/baseline.json
# Make one focused optimization, then repeat the identical workloads.
node benchmarks/loom/run.ts --output .t3/benchmarks/after.json \
  --baseline .t3/benchmarks/baseline.json --check
```

For a comparison that controls drift between the original and optimized implementations,
replay the original target source and alternate the run order within each round:

```sh
node benchmarks/loom/run.ts --output .t3/benchmarks/paired.json \
  --compare-ref d22797d754 --check
```

This runs three original/current pairs in fresh processes, alternating which version runs
first. It saves `paired.reference.json` and `paired.json`, including source revisions,
SHA-256 digests and run order. Every reference sweep must attest loading all six recorded
source hashes before its measurements are accepted. Both versions use the current harness
and identical fixtures. A benchmark-only Vite loader reads the six target modules directly
from Git; it never changes checkout files. Shared runtime dependencies must be unchanged,
or the comparison is rejected. Paired mode also requires the median reduction across
matched original/current rounds to meet the same limits, in addition to the aggregate gate.
Use this mode to validate improvements when separate runs
may have experienced different host load or garbage collection.

`node_modules/.bin/vp` is resolved locally by the runner. No global installation is needed.
The default is three sequential sweeps in fresh Vitest processes. Warmup runs at least five
calls, aims for 100 ms, and stops after 10,001 calls for very fast cases. Sampling then runs
at least 21 individually timed operations and 250 ms per case. Very fast workloads stop after 20,000 samples. Fixtures, assertions,
output hashing and database setup are outside the timed region. Async operations are awaited.
The timer includes await overhead and garbage collection, consistently before and after.

Use `--filter pcb.` or another ID prefix for a focused sweep. `--sweeps`, `--samples` and
`--min-time-ms` control measurement duration. Use at least the defaults for comparisons.
Run on the same machine/runtime under similar load, without concurrent tests, builds or
performance runs. An incompatible CPU, Node version, OS or architecture is rejected.
A new machine needs its own baseline. Timing assertions are opt-in; ordinary test runs skip
the performance workload and still run the harness correctness tests. The existing Loom
maintenance checks discover these tests and include benchmark lint and typechecking; they
do not enable timing gates.

`--check` requires at least 20% lower median latency on each selected target present in the
run, and allows no more than 15% median regression on other cases. A filtered run checks
only that subset. A complete acceptance pass uses all cases. These thresholds are recorded
in [report.ts](./report.ts), where targets are explicit. A target improvement is meaningful
only if its output fingerprint and workload are identical to the baseline.

## Workloads and measurements

| Area                    | Workloads                                                                                | Why measure this                                                                                                                                          | Improvement target  |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| PCB connectivity        | 100 components × 8 pins; 1,000 × 16; missing and existing pads                           | Board inspection, pin mapping and agent inspection must scale with connectivity rather than components multiplied by the entire netlist.                  | 1,000 components    |
| PCB drawing differences | 256² pixels with 64 sparse islands; 1,024² identical and fully changed images            | Revision comparisons need bounded CPU for both unchanged drawings and dense changes. Dilation, region merging and truncation are included.                | Dense 1,024² image  |
| 3D snapping             | Closed cylinder caps with 256/4,096 spokes; ordinary indexed plane with 32,768 triangles | High-valence CAD vertices expose topology scaling problems; the regular mesh guards ordinary models. Welding and smooth-region construction are included. | 4,096 spokes        |
| 3D print checks         | Subdivided closed boxes with 12,288/49,152 triangles; a 49,152-triangle thin plate       | Spatial-grid construction determines how long print checks wait before thickness rays can begin.                                                          | 49,152-triangle box |
| Code map                | Broad search at 10k/100k nodes; exact/missing search at 100k; 400k edges                 | Search-as-you-type and agent symbol queries should not sort every match to return 50. Duplicate names and shuffled file paths exercise ranking and ties.  | Broad 100k search   |
| Code map loading        | Parse/index 100k nodes; cold and repeated summaries on the same graph                    | Cold measurements expose preprocessing costs; repeated overview requests expose avoidable graph-wide recomputation.                                       | Repeated summary    |
| Library history         | 100/1,000/8,000 items; two alternating transactional archive saves per operation         | Saving a long conversation should not require one SQL effect per displayed item. The real browsing index and FTS synchronization are measured together.   | 8,000 items         |

The Library fixture uses isolated in-memory SQLite, preexisting compressed blobs, no embedding
model, and deterministic synthetic messages. Every operation writes archive A then archive B,
so each sample finishes in the same verifiable state. It excludes fresh gzip compression,
disk fsync, replication and network time. It verifies retained complete history, newest and
older page order, browsing/search row counts and blob deduplication.

Every case runs semantic checks and computes a SHA-256 fingerprint before and after sampling.
Fingerprints also have to match across sweeps and against the baseline. Geometry checks cover
all topology/grid buffers and known ray hits; PCB checks cover complete connectivity and exact
region order; graph checks cover ranked outputs or complete parsed adjacency.

The aggregate latency is the median of the individual sweep medians, giving each fresh
process equal weight. p95 is the nearest-rank percentile of all individual operation samples.
Reports retain raw samples, each sweep's median, workload sizes, fingerprints, hardware,
revision, dirty paths and timestamps. New runs also capture host load and free memory
around each measured case, so unrelated contention can be distinguished from code regressions.
CPU time and heap/RSS deltas are advisory observations.
Heap/RSS deltas are affected by GC, fixtures and process reuse; they are not allocation counts
or peak-memory measurements and are not acceptance gates. On macOS, raw free memory also
excludes reclaimable memory; use `memory_pressure -Q` when checking memory pressure.

## Baseline and repetition

[results/baseline.json](./results/baseline.json) preserves the initial compact baseline and
its source revision. Local `.t3/benchmarks/*.json` reports retain raw samples. The compact
baseline is machine-specific; its measurements can be compared directly only on matching
hardware/runtime. The final compact comparison is saved alongside it.

For each sweep: identify the dominant measured cost, change one algorithm per target, run
its behavioral regressions, then repeat the same cases. Revert or revise a change if its
correctness fingerprint differs or a guardrail regresses. Run the complete suite after
integration and repeat it to confirm the selected targets hold. Stop once targets and
relevant checks pass.

These are component/service CPU baselines, not client frame-time, GPU or end-to-end RPC
measurements. Backend improvements apply to callers through the same service, including web,
desktop, mobile and agent tools where that feature is available. Web geometry/drawing changes
apply to the shared web/desktop implementation. No client layout or wire contract changes.

## Recorded comparison

Measured on the same Apple M5 Pro / Node 24.21.0 host with three fresh-process sweeps
before changes and three final sweeps after host contention subsided. Values are milliseconds
per operation, using the median of sweep medians. These synthetic component measurements do
not establish end-to-end application latency. System load and garbage collection affect exact
percentages; unchanged parse throughput is a guardrail, not a direct optimization claim.

| Workload                              | Baseline median | Final median | Reduction |
| ------------------------------------- | --------------: | -----------: | --------: |
| PCB merge, 1,000 components           |         133.905 |       22.447 |     83.2% |
| PCB drawing, dense 1,024² image       |          43.768 |        4.008 |     90.8% |
| 3D snapping, 4,096 spokes             |          75.840 |        3.275 |     95.7% |
| Print-check grid, 49,152 triangles    |          23.806 |        1.729 |     92.7% |
| Code map broad search, 100k nodes     |         118.181 |        5.814 |     95.1% |
| Code map cold summary, 100k nodes     |          71.353 |       18.931 |     73.5% |
| Code map repeated summary, 100k nodes |          69.929 |       <0.001 |    >99.9% |
| Library history, two 8,000-item saves |         266.063 |      143.327 |     46.1% |

All seven target cases exceeded the 20% reduction goal. All 21 workload fingerprints match
the baseline, and no ordinary/cold workload exceeded the 15% regression allowance. Raw
latency samples and per-sweep medians are retained in local JSON reports. Compact baseline
and final records, including p95 and source revisions, are checked in under
[results](./results/). The final record is [after.json](./results/after.json).

Focused PCB, geometry, Code map, Library, harness and maintenance regression suites passed.
Web, server and benchmark typechecks and targeted strict lint passed. One optional real-model
embedding test was skipped because its model fixture was not configured. Browser/GPU/frame-time
verification was outside this component-benchmark pass.

## Further opportunities

The review also identified useful follow-on workloads. They are deliberately separate from
the measured acceptance targets above:

- Library first-save compression and peak memory versus archive bytes; semantic ranking with
  a dense relevant corpus. Random vectors rarely cross the similarity threshold and can
  conceal ranking costs.
- PCB fabrication checks versus via/pad counts, especially distance checks and repeated parsing;
  3D board classification versus mesh count and total vertices.
- File outline extraction and edit reparse on realistic 100 KB/1 MB sources, separately from
  unchanged shared-cache hits, across supported languages.
- G-code parsing and layer encoding at 50k/500k/2m moves, including output bytes and decimation;
  interactive section thickness on dense hollow parts.
- Integrated panel-open latency, frame times and remote payload sizes when client/browser
  verification is authorized. Component latency alone cannot establish those results.
