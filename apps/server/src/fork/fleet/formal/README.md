# Library dispatch invariant

The bounded model checks that a remote request is bound before its first provider
message, including retries, cancellation, link revocation and up to two restarts.
It explores two request IDs. Durable launch/message deduplication is modeled by those
IDs, rather than by a fresh ID on every retry.

`LibraryDelegation.launchLibraryRemoteTask` maps Launch to an idle t3_thread_launch,
Bind to loom_library_thread_bind, and Send to t3_thread_send with the stable
`:message` request ID. The corresponding service regression proves a failed bind
cannot send a prompt and a retry retains both request IDs. Upstream's request receipts
and RemoteDelegation tests cover the destination deduplication/recovery boundary.

Assumptions: committed launches, bindings and message receipts survive restart; each
modeled operation is atomic; the destination enforces link authorization at its own
boundary. In-flight authorization races, storage faults, unbounded requests, eventual
completion and arbitrary provider behavior are outside this model. This is not a proof
of the whole application or an entitlement/reachability check.

Run TLC with Java and a separately obtained, pinned tla2tools 1.8.0 jar. No jar or new
production dependency is shipped. From this directory:

```sh
java -cp /path/to/tla2tools-1.8.0.jar tlc2.TLC -workers 1 \
  -metadir /path/to/external-model-state -config LibraryDispatch.cfg LibraryDispatch
```

The jar SHA-256 used for verification is
`fc6878c603f0fdc18b9fe3e5bf51860cb90ab5b1154e3c371660c036d6bdd63e`.
For a mutation check, copy the model outside the repository and replace Send's
`r \in bound` guard with `r \in launched`. TLC must produce a NoUnboundDispatch
counterexample. Keep run state, traces and mutation copies outside the worktree.
