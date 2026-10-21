# L111: Optional item sharing and emergency access

Status: Designing. Optional idea beyond the first personal daily-use target. Kyle's priorities and first platforms were confirmed on 2026-10-21; sharing and emergency access were not prioritized. [L101](../L101-personal-vault-passwords/)'s first build is In progress elsewhere; this packet is not selected independently.

Share a deliberately selected item/version with a verified recipient key, inspect access and stop future delivery. Explore emergency requests with a visible waiting/review/cancel process whose cryptographic release model is honest about offline availability and copied data.

## Scope

- In: engine-native per-item recipient-key sharing where supported, out-of-band key verification, explicit version/update policy, expiry, revoke, recipient removal, encrypted receipts and recovery.
- In: emergency waiting/cancel/review design and its independent custody/release requirements.
- Out of the first daily-use target: family/team administration and promised automatic emergency release from an untrusted server. Keep both as explicit future decisions, not hidden dependencies.

## Surfaces and boundary

If this optional scope is later selected, proposed acceptance uses independently trusted clients on the confirmed daily-use targets: Mac+iPhone, Safari/Chromium (Kyle, 2026-10-21). Compatibility is tested separately; these platform choices do not select or prioritize sharing. Android/Windows/Linux/web have no secret-bearing recipient flow until their custody is proven. Remote/relay/tunnel environments relay ciphertext and bounded routing metadata only.

Personal sharing/release primitives are proposed in [Personal Vault](../LOOM-PERSONAL-VAULT.md), not an implemented common API. Follow the maintained engine evaluation in [L102](../L102-personal-vault-custody/). Missing engine-native recipient/release support yields unavailable; whole-database KDBX does not imply item sharing. No upstream code seam has been made; [SEAMS](./SEAMS.md) records review areas.

## Documents

[PRODUCT](./PRODUCT.md), [TECHNICAL](./TECHNICAL.md), [SEAMS](./SEAMS.md), [IMPLEMENTATION](./IMPLEMENTATION.md), [TESTING](./TESTING.md), [REFERENCES](./REFERENCES.md).
