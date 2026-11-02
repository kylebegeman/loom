# L11 continuation

The development tools and individual HTTP request lab use the current services and contracts
in [TECHNICAL.md](./TECHNICAL.md). Preserve checkout ownership, exact resources, execution
permissions and the existing Browser capture. Do not revive the earlier project-wide run
model or a separate diagnostics collector.

The lab's saved-history list contains summaries; full payloads load on selection. New work
must preserve request-ID receipts, including after clearing, so recovery never silently repeats
an operation whose response was lost. API workspace runs add a receipt around preparation,
dispatch, response scripts and capture persistence. Capture context must stay pinned to the
selected source and revision. Collection runners, synchronization, extra script APIs, database
queries and background request replay remain follow-up work.

Read the implementation and [TESTING.md](./TESTING.md) before extending it.
