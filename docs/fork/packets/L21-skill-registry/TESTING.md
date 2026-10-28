# L21 verification

Focused tests beside the server service cover shared account roots, native Claude and
Codex controls, complete binary/script copies, pinned source revisions, cancellation,
request reuse, optimistic edits, install rollback, update review conflicts, metadata
failure recovery and trash. RPC tests cover environment permission ceilings.

The client filter regression combines account, scope and state on one provider report.
Panel and keybinding registry tests cover availability and import-order invariants.
Typecheck contracts, client-runtime and all consuming clients and server after a wire
change. Run the changed-file gate before landing.

Use test-t3-app with an isolated sandbox project for integrated inventory, Sources,
Lab, update/trash, test-draft and responsive checks. Install into the sandbox project's
skill roots only. Do not toggle or edit the operator's real account skills during
verification. Native provider behavior is exercised through service fixtures; a draft
needs no paid agent turn.
