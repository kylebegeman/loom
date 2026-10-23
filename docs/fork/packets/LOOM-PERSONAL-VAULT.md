# Loom Personal Vault

Status: **Brainstorm and implementation started, 2026-10-21.** Kyle asked to explore personal
password-manager features, generate implementation packets and start building. The detailed
scopes below are proposals from that request, not eleven individually selected features.
L101 is the first local build. L102 to L110 retain the broader outcome for design; L111 is optional.

[Interactive feature overview](./LOOM-PERSONAL-VAULT.html) ·
[Development Vault](./LOOM-VAULT.md) · [Implementation queue](./IMPLEMENT-NOW.md)

## Product direction

Build a personal password manager that fits Kyle's daily use and agent workflows. One Vault
experience can hold both personal accounts and development identities while keeping their
key custody and execution authority independent. Saving the annual subscription is not the
success criterion. Reliable daily access, deliberate delegation and recoverability are.

Kyle confirmed on 2026-10-21 that the priorities are daily password-manager use, browser and
phone autofill, and carefully scoped agent access. The first usable platforms are Mac and
iPhone, with Safari and Chromium. Android, Windows, Linux and web behavior remain tracked
explicitly. These confirmations guide the broader proposed scope; they do not select individual
L102 to L111 packets, an engine or a trusted-client topology. Recovery details remain open.
Sharing and emergency access remain optional and are not prioritized by the platform choices.

## Features worth exploring

### Everyday use

- Keep several accounts for the same site, with explicit personal/work identity choice.
- Search logins, notes, licenses, recovery codes, cards and identities privately; pin frequent items.
- Generate passwords locally and choose site-compatible character rules. A reviewed word-list
  passphrase generator can be evaluated separately; it is not the declined BIP39 utility.
- Fill with a browser shortcut or the phone's system credential provider. Detect changed forms,
  frames and navigation before releasing a value. Save and update only after review.
- Work offline on an enrolled device, unlock conveniently, and inspect conflicting edits.
- Move data through reviewed local imports and encrypted portable exports, including attachments
  and records the importer cannot understand.

### Agent access that belongs in the product

- **Approve an outcome:** choose an account and a supported operation, such as downloading a
  particular invoice, with a preview of the authority the adapter actually enforces.
- **Lend a session:** authorize a site, task, duration and available operations; inspect, cancel
  and expire that session from the same place. Prefer opaque handles and safe receipts.
- **Graduate access:** use a personal setup flow to create a dedicated development identity,
  then leave the recurring automation on that narrower identity where the provider supports it.
- Show who currently has access, why, on which device, and when it expires. Bundle a coherent
  task approval without silently widening its rights.
- Require deliberate user presence for sensitive account actions. Optional account creation and
  email-alias connectors can be explored after the core flows; no live signup is implied.

A generic logged-in browser session may retain the account's full powers. Read-only intent is
not enforcement. Browser automation can read page values even when snapshots mask passwords.
Trusted personal autofill therefore needs its own boundary; filling a secret into an
agent-controlled page exposes it to that automation boundary.

### Trust and recovery

- Keep personal unlock material off unattended development hosts; encrypt sensitive metadata too.
- Inspect trusted devices, remove a lost one, and explain the limits of offline revocation.
- Recover on a clean device when the server and primary laptop are unavailable. Keep recovery
  material independent of the infrastructure whose credentials it unlocks.
- Check password reuse and weakness locally; distinguish a saved new value from a successfully
  changed password at the website.
- Explore per-item sharing and emergency access later, with honest limits once a recipient has
  decrypted or copied a value.

## Implementation packets

| ID   | Packet                                                                   | Proposed outcome                                                                      | State         |
| ---- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------- |
| L101 | [Local password tools](./L101-personal-vault-passwords/)                 | Local, cryptographic generation with explicit copy and clear.                         | In progress   |
| L102 | [Personal custody and unlock](./L102-personal-vault-custody/)            | Independent personal keys, trusted clients, device unlock and real process isolation. | Designing     |
| L103 | [Personal credential library](./L103-personal-vault-library/)            | Logins, notes, recovery codes, cards and identities with private search and history.  | Designing     |
| L104 | [Reviewed personal migration](./L104-personal-vault-imports/)            | Local 1Password import review, duplicate handling, attachments and portable exports.  | Designing     |
| L105 | [Trusted browser autofill](./L105-personal-vault-browser/)               | Origin-bound Chromium and Safari filling, account choice, and save/update.            | Designing     |
| L106 | [Agent session delegation](./L106-personal-vault-agents/)                | Approve an account, destination, task and duration; inspect and end its session.      | Designing     |
| L107 | [Native autofill and passkeys](./L107-personal-vault-native/)            | Phone credential providers, desktop quick access, TOTP and reviewed passkey custody.  | Designing     |
| L108 | [Encrypted sync and offline use](./L108-personal-vault-sync/)            | Trusted-device caches, encrypted synchronization and visible conflict handling.       | Designing     |
| L109 | [Recovery and device loss](./L109-personal-vault-recovery/)              | Independent recovery material, clean-device restoration and lost-device handling.     | Designing     |
| L110 | [Account maintenance](./L110-personal-vault-maintenance/)                | Local weakness and reuse checks, reminders and reviewed account changes.              | Designing     |
| L111 | [Selective sharing and emergency access](./L111-personal-vault-sharing/) | Optional item-specific sharing, recipient keys and a cancellable emergency process.   | Optional idea |

## Shared design constraints

### Two custody domains

The existing development system uses OpenBao KV v2 and the Loom server reads decrypted
payloads. It remains appropriate for explicitly delegated development credentials. Personal
root keys require an independently trusted client and a separate unlock/decryption path.
Different labels, collections, mounts or browser profiles do not create that separation.
`Redacted` prevents accidental inspection, not access by the service holding a value.

Evaluate maintained formats and engines before selecting personal storage. Compare an
established interoperable vault format with a client-encrypted record engine, including mobile
support, key derivation, encrypted metadata, conflicts, recovery, licensing and review history.
Use established cryptographic components; no custom cipher or new production dependency is
selected by these packets. The current OpenBao investment need not determine personal key custody.

An independently installed trusted client has different supply-chain assumptions from a web
client delivered by the storage server. Neither is a sandbox against a full-access process
running as the same OS user. Specify and test the actual OS-user/process/device boundary before
claiming that development agents cannot reach personal keys.

### A client boundary, not more environment grants

Personal items belong to the human owner and trusted devices, independently of the currently
selected development environment. The proposed shared boundary must support unlock/lock,
metadata inspection, item/version operations, encrypted sync and reviewed use requests without
placing personal values in ordinary environment RPC, chat snapshots, Library artifacts or MCP.
This is a target interface, not an existing contract or a ready-to-copy extension point.

Each packet consumes a proven shared primitive or shows an explicit unavailable state. A packet
does not assume another feature UI exists. Promote shared interfaces through
[EXTENSION-POINTS.md](./EXTENSION-POINTS.md#personal-vault-client-boundary-proposed) after the
custody/engine evaluation, and verify exact source seams before implementation. L101 is already
independent: it uses no personal storage interface, backend or wire capability.

### Agent and session semantics

Use the common service boundary for Codex, Claude, Cursor, Grok, OpenCode, Antigravity and other
installed providers, rather than provider-specific personal-secret injection. Scheduled agent
runs need the same current authority and session checks. Command-only jobs and unsupported
clients receive no implicit access. An item reference or a remembered account name grants nothing.

A grant can narrow adapter operations only when execution is actually mediated. Ending local
cookies or an opaque handle ends local use; provider-side revocation is a separate supported
operation. Previously copied passwords and cookies cannot be recalled. Recovery restores state
without silently resurrecting revoked device trust or stale grants.

## What to build first

1. **Local tools:** share the existing Utilities password generator with native clients and add
   explicit local controls, with no automatic persistence. L101 is this build.
2. **Custody proof:** compare maintained engines using synthetic records, prove key separation,
   lock lifecycle and clean-device recovery before real personal accounts.
3. **A daily-use loop:** typed logins, one trusted browser integration, one phone autofill path,
   encrypted sync/offline behavior and a reviewed import. Expand platform coverage visibly.
4. **Delegated use:** one real enforced adapter and inspectable task-bound session before generic
   agent sign-in. Add maintenance, richer item kinds and optional sharing as their foundations hold.

The sequence is delivery order, not a promise that feature packets depend on each other. Shared
primitives belong in their verified extension boundary. It does not defer minimum recovery until
a later polishing packet or reduce the complete personal-manager outcome to a generator.

## Build state and verification limits

L101 introduces local password controls for web/desktop and mobile and reuses the existing L27
Utilities generator through shared client code. The tool is useful without OpenBao or a connected
server once the relevant app settings are accessible. It is not personal encrypted storage,
autofill, an independent offline application or an agent credential-delivery feature.

The local build passed 114 focused tests, client-runtime/web/mobile package typechecks, targeted
source lint and mobile static lint. Real-client browser/device interaction remains unverified.

No personal data import, credential registration, deployment, release, new dependency or schema
migration is authorized by this document. Kyle's current request authorizes local implementation;
production operations and real personal data require their applicable authorization. Browser and
device acceptance still follows the repository's explicit-authorization rule.

### Source anchors

- `packages/contracts/src/fork/vault-core.ts`: current environment record contracts and metadata.
- `apps/server/src/fork/vault/VaultCore.ts`: environment namespace, version/CAS and reveal boundary.
- `apps/server/src/fork/vault/OpenBaoStore.ts`: backend token access and server-readable payloads.
- [L79 custody limits](./L79-vault-core/TECHNICAL.md#connection-and-custody): current key and OS limits.
- `apps/server/src/preview/ServerBrowserPage.ts`: browser evaluation authority, distinct from masking.
- `apps/web/src/fork/utilities/tools/generate.ts`: existing password-tool consumer.
- `apps/mobile/src/features/cloud/dpop.ts`: existing Expo cryptographic random-byte adapter.
- [L88 recovery](./L88-vault-recovery/): unfinished development-Vault operating/recovery scope.
