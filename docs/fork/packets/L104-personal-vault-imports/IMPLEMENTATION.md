# L104 implementation packet

## Before parsing real data

Read the [umbrella](../LOOM-PERSONAL-VAULT.md), conventions, 1Password's official export/1PUX
docs and current development import code. Check available shared personal primitives; keep
actual imports disabled where custody, typed storage or recovery support is absent. Do not
request a raw export in chat or copy one into this checkout.

## Ordered steps

1. Create synthetic supported/unsupported 1PUX fixtures with multiple account/vault groups,
   every proposed item family, duplicate ids, custom sections and attachment edge cases.
   Record the exact official source format/version supported without guessing coverage.
2. Define a bounded parser result, loss/limitation report and exact accounting invariants.
   Implement format/path/size/entry validation before mapping or file extraction. Choose any
   production archive dependency through the existing dependency-review process.
3. Add pure typed mapping with unknown-field preservation, ambiguous-field review, protected
   TOTP parameter retention and explicit passkey/history omissions. Never print input values
   in parser exceptions or test failure snapshots.
4. Add trusted-local preview and duplicate decisions using encrypted source provenance.
   Bind review to source digest, adapter, owner/Vault, mapping and expected revisions. No
   personal preview data travels over Loom RPC/MCP or through a served web bundle.
5. Commit via reviewed shared encrypted storage with local idempotent receipts. Test response
   loss and crash restart before adding resume/retry. Implement inspect/cancel, pending versus
   committed results and complete item/attachment reconciliation.
6. Add conflict-aware undo with encrypted preimages and policy-driven retention. A subsequent
   edit must block an automatic undo; allow inspection and deliberate resolution. Do not
   delete/modify the original export or change a live source account/configuration.
7. Add encrypted portable export using reviewed engine support if available, otherwise show
   unsupported. Write/finalize locally, verify reopen on a clean trusted fixture client,
   cancel incomplete output and inspect unknown outcomes before any retry.
8. Integrate trusted Mac file selection and iPhone encrypted-result/recovery acceptance.
   Enable iPhone raw import only after its actual local adapter passes. Keep Android,
   Windows/Linux/general web explicit in the unsupported matrix and future work.
9. Run focused suites and affected checks, then an authorized integrated pass with synthetic
   data. Record remaining fidelity limits and independent security review before any critical
   personal migration. No credential import or live rollout is authorized by this packet.

## Done evidence

Every parsed item and attachment is accounted for, retries cannot duplicate committed writes,
undo cannot destroy later edits, and no original file is modified. Encrypted output reopens
without original transient state. No raw export, mapping detail or personal field reaches an
agent, server, RPC/MCP/prompt, log or workspace. Current status remains proposed design.
