# L110 product

## Proposed outcome

Kyle can review a small private maintenance inbox on an unlocked trusted client: reused passwords across accounts, weak-password estimates, duplicated records and approaching declared expirations. Findings explain what was compared and when; unknown expiry is not healthy status. Analysis runs locally on demand or after unlock, never by sending secrets or secret-derived lookup material to a remote service.

## Review and actions

- Open maintenance from Personal Vault, an item detail, settings or the command palette. Inspect a finding, dismiss/restore it, snooze/unsnooze a reminder or cancel a scan. Findings become stale after an item revision changes and are recomputed locally.
- Reuse groups identify affected accounts without displaying their common password. Distinguish duplicate records from distinct accounts using the same password; do not merge, delete or rotate automatically. False positives have an explanation and dismissal tied to relevant item versions.
- Expiry uses a user-entered date or verified provider evidence with a source label. Local notifications are generic on the lock screen; opening one requires unlock. Disabling reminders cancels pending notifications. An offline or locked device may miss its reminder; no host-side secret scan runs to compensate.
- Prepare a replacement locally, review the exact account/site and adapter operation, then authorize a specific change from the independently trusted client. A manual path opens the verified site in a trusted context; Kyle confirms what they observed. The new value remains a draft until its state is resolved.

## Rotation status must tell the truth

Show remote change **not attempted**, **confirmed by provider**, **reported by Kyle**, **failed** or **unknown**, independently of whether the replacement was **saved**, **save failed** or **conflicted**. Saving a replacement is never labeled account changed. A successful remote change followed by a local save failure needs a recoverable encrypted pending replacement and an urgent repair path. An unknown provider result requires receipt lookup or a supervised check, never blind retry. After remote commit, cancel cannot promise rollback; report what remains to reconcile and whether an old credential/session is still active.

Unsupported sites retain manual review and secure draft handling. A provider that cannot verify account change must not receive a fabricated success receipt. Password expiry is not a recommendation for periodic password changes; prefer changing weak/reused/compromised credentials and retain expiry reminders for genuinely expiring credentials.

## Custody and surfaces

Personal checks and drafts live on independently trusted clients, separate from the unattended development host and unrestricted same-user agents. A browser profile, UI permission or safeStorage setting does not establish that isolation. Provisional acceptance is Mac+iPhone; Safari/Chromium handoff must each preserve the verified origin and stay outside agent-controllable preview. Android/Windows/Linux/web show unavailable until their local custody and reminder behavior are verified. Older/upstream servers hide remote status affordances without blocking trusted local use where implemented.

All providers and scheduled agents use only the same explicitly granted metadata/outcome service if any is offered. They cannot scan personal values, read replacement drafts, approve rotation or obtain raw credentials through MCP/RPC/prompts. Command-only jobs remain unsupported absent an explicit broker. Local/direct remote/relay/tunnel connections never change this boundary.

## Open choices

Choose the first real rotation provider, acceptable manual verification wording, reminder cadence and local weak-password estimator. These are proposals, not Kyle's individual selections; no new production estimator dependency has been authorized. Independent security review precedes critical personal custody, while synthetic fixture implementation can proceed now.
