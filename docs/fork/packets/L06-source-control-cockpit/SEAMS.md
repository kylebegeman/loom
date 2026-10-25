# L06 seams

The minimal recovery slice uses `source-control-cockpit` markers in Git contracts,
GitVcsDriverCore/GitManager/GitWorkflowService, RPC registration, shared status merging,
client-runtime Git actions, and web/mobile Git controls. Web palette/keybinding integration
uses the same seam. Per-project confirmation adds one optional project settings field.
The integrator owns the matching `docs/fork/seams.tsv` rows.

The future panel views should use the extension points described in README and reuse
these recovery services. They do not need a second Continue/Abort RPC or subscription.
