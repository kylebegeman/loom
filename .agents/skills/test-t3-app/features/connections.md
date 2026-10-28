# Routes, reconnects and performance

Start with an owned isolated environment. Exercise local, remote direct and supported
relay/Reach routes with the same environment identity. Confirm discovery chooses eligible
routes, reconnect preserves the conversation and no Loom operation replaces another
app's Tailscale Serve mapping. Disconnect and restore the owned route; never kill a
shared daemon or manipulate another service's ports.

Use stable sandbox datasets for thread opening, long history, Replay streaming,
reconnect and idle. Record build SHA, client/surface, dataset hash/count, workload,
error/work counts, warmup and repeated alternating measurements. Use the benchmark
checklist before claiming a regression or improvement. Do not add arbitrary timing
assertions to unit tests or run a repo-wide suite for performance evidence.

Evidence: route/identity before and after, resumed history and bounded measurement
artifacts with actual failures. A public HTTPS/OAuth connector needs a real external
caller; a successful local request does not prove Grok Bot reachability.
