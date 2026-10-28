---
name: benchmark-checklist
description: "Validate a performance measurement, workload and error count before making a speedup or regression claim."
license: MIT
disable-model-invocation: true
compatibility: "Loom tools; provider-discovered project skills; delegation and writes require the current task authorization."
metadata:
  upstream: pstack
  revision: c742dd61706fbacc1b95f1a20b7b988cf096ce6c
  adapted-for: loom
---

# Benchmark checklist

Read the shared [Loom runtime contract](../loom-workflows/references/runtime.md). It preserves current permissions, exact models and work ownership.

Write the intended claim with units, dataset, build and user journey. Read the harness and prove the measured work actually runs and produces correct outputs. Count failures, rejections and retries separately from successful samples.

Record OS, hardware, software versions, build mode, warm/cold cache policy, dataset identity and relevant concurrent load. Use platform-appropriate read-only probes, such as sysctl on macOS, instead of assuming Linux tools. Profile separately to find the limiter; exclude profiler runs from reported measurements.

For comparisons, use equivalent tuned configurations and at least five alternating runs per side. Report median, range and error/work counts. Check physical limits and the changed component's share of end-to-end time. If variation dominates, the limiter is unknown, a side is untuned or work/error counts are missing, report inconclusive. A requested one-run ballpark stays labeled as one run and still validates work and errors.
