# L105 implementation packet

## Establish the boundary first

Read the [umbrella](../LOOM-PERSONAL-VAULT.md), conventions and current preview evaluator.
Use synthetic sites/credentials. Inspect shared personal primitives; an absent trusted
custody/delivery adapter leaves autofill unavailable. Do not start from a T3 preview profile.

## Ordered implementation

1. Document exact trusted Mac/browser topology and adversarial full-access agent principal.
   Identify required OS separation, signed component identities, debug/UI-automation exposure
   and recovery path. Keep unsupported state honest if the topology cannot protect disclosure.
2. Define versioned safe capability and pure origin/frame/document matching contracts. Add
   failing tests for suffix lookalikes, default/changed ports, opaque frames, redirects and
   stale documents before building browser UI.
3. Select real Chromium extension and Safari/Apple target packaging. Review any production
   dependency/entitlement choices before adding them. Define signed native-host identity,
   extension pairing, caller authentication, protocol skew, inspection/cancel and unpair/revoke.
4. Implement the independently running trusted local companion/custodian link, never a
   server decryption endpoint. Verify unlock/presence with Electron and Loom server stopped.
   Unsupported native/ad-hoc builds show unavailable rather than weakening caller checks.
5. Build on-demand suggestions and deliberate per-document fill with authoritative sender
   context, final origin/frame/navigation checks and one-shot local delivery. Reject missing
   match/custody primitives. Implement lock/revoke/cancel races before enabling fill.
6. Add trusted local save/update review with explicit item/origin choice, expected revisions,
   encrypted receipts and history restoration. Submission detection is a suggestion only.
   Resume/inspect lost outcomes before retry; avoid duplicate items after worker restarts.
7. Inventory actual iOS engine, extension and credential-provider capabilities for iPhone
   Safari, Chrome and other branded browser apps; exact apps/versions remain open. Integrate
   supported autofill through shared native provider adapters under
   [L107](../L107-personal-vault-native/), with reviewed signed extension targets where supported,
   and test app-independent entry. Do not assume desktop Chromium extensions work on iOS.
   Native OS provider ceremonies remain in L107; do not duplicate them or depend on its
   private modules. Keep Android, Windows/Linux and unsupported frame cases
   tracked with clear states; card/identity/TOTP/passkey adapters remain unavailable until
   their exact shared/platform policy is implemented and reviewed.
8. Wire safe setup/status/lock-launch entry points into ordinary Loom UI. Personal values,
   suggestions and sites never enter server/RPC/MCP/prompt state. All providers/scheduled
   agents share the same limited capabilities; command jobs lack personal delivery.
9. Run focused matching/protocol tests and actual native/extension checks. With authorization,
   the primary agent performs the integrated browser/device pass on synthetic data, tests
   explicit exclusion of T3 preview, and records independent security review before critical
   personal use. No live extension distribution or deployment is implied.

## Completion evidence

Mac Chromium/Safari and the selected iPhone integration have real installed-target evidence;
all other combinations are accurately unsupported. Unlock works independently of Loom,
matching survives adversarial navigation/frame tests, save/update can be inspected/cancelled/
restored, and lock/revoke stops pending use. An agent cannot obtain fields through preview,
local impersonation, a special provider adapter or unknown-outcome replay. This packet itself
implements none of those claims.
