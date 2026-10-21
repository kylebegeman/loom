# L109 implementation plan

Status: Designing. Proposed scope pending [Kyle's priority answers](../LOOM-PERSONAL-VAULT.md); no individual implementation selection, live migration or deployment authorization.

## Before starting

Read current repository guidance, packet conventions, all seven documents and [L88](../L88-vault-recovery/). Reverify source and native seam inventory. Keep L88's development server authority separate from personal data recovery. Read [L102's maintained-engine evaluation](../L102-personal-vault-custody/TECHNICAL.md#engine-format-and-keys), KDBX 4 first candidate, not selected. Coordinate selected-engine backup/sync behavior with [L108](../L108-personal-vault-sync/) without treating either packet's proposed APIs as implemented prerequisites.

## Steps

1. Resolve recovery owner/custody policy, destinations, retention, recovery targets and provisional platform order. Write synthetic loss-case fixtures covering a surviving device, no devices, no server, stale archive and missing kit/data.
2. Compare native whole-database/KDBX recovery with a maintained record-engine recovery path. Record actual required factors, encrypted export/format, integrity/resource limits, independent open interoperability and available authority controls. Do not add a custom recovery key/archive/chain. Independently review integration before critical custody; harmless local fixtures need no extra gate.
3. Inventory independently signed native recovery client distribution, protected storage, input, file/print/share paths, Safari/Chromium launch routes and background/crash cleanup. Implement explicit unsupported outcomes for missing guarantees.
4. Implement kit preparation using actual engine factors/instructions and its supported encrypted export. Prove a consistent backup opens independently, preserve supported content and report omissions, with independent custody instructions and interrupted-write cleanup. No secret material crosses host RPC/state persistence.
5. Implement offline native-backup inspection/staging/restore into an isolated profile without the original server. Use engine parsers/integrity/KDF limits, preserve supported deletion/history/conflict data and report gaps; keep external access inactive.
6. Reconcile available current engine/storage evidence, supported device/storage revoke and engine-native factor change/re-key. Test stale complete databases carrying obsolete data/permissions. If freshness is unprovable, isolate recovery or initialize/re-key a replacement with fresh supported storage credentials. Explain old keys/copies may remain usable; never reactivate grants from backup metadata.
7. Implement inspect/cancel/close/cleanup/retire/remove actions and durable local receipts. Add optional host metadata services, contracts and provider tools only at the same authorization gates. Seek any required dependency/schema approval under existing repo rules before applying those changes.
8. Integrate provisional Mac/iPhone/Safari/Chromium flows. Keep Android/Windows/Linux/web acceptance tracked as unsupported until native proofs exist. Demonstrate local recovery without L108's relay and infrastructure restore without L109 keys, preserving [L79](../L79-vault-core/), [L81](../L81-vault-grants/), [L85](../L85-vault-delivery/) and [L87](../L87-vault-lifecycle/) ownership.
9. Run focused implementation checks in TESTING.md. With Kyle's browser/device authorization, the integrating agent performs one real-client recovery exercise. Update actual seams/results and user help; do not import real personal credentials or perform a live cutover.

## Done when

The [conventions definition](../CONVENTIONS.md#definition-of-done) and every claimed PRODUCT/TESTING case pass. Restored content and current authority are separately verified, unsupported platforms stay honest, and old kits/archives/copies have explicit limits. Independent review precedes critical custody; these documents add no gate to harmless local work.
