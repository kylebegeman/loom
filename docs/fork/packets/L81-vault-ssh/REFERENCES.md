# L81 references

## Product selection

Kyle selected all sixteen Loom Vault ideas for implementation on 2026-10-17. This packet is
**V10** in the [shared index](../LOOM-VAULT.md). It is new platform scope, not a claim of
an old Loom implementation or inherited P/F selection.

## Current source

Initial review against `2f385ee835`; the mediated implementation starts from `c27859db7d`.

- [`packages/ssh/src/auth.ts:1`](../../../../packages/ssh/src/auth.ts#L1): Existing askpass and SSH authentication abstraction.
- [`apps/server/src/device/SshDeviceHost.ts:241`](../../../../apps/server/src/device/SshDeviceHost.ts#L241): Device-host SSH consumer.
- [`apps/server/src/fork/mini-offload/MiniSshTransport.ts:27`](../../../../apps/server/src/fork/mini-offload/MiniSshTransport.ts#L27): Worker SSH uses batch mode and verified host keys.

## Implemented source

- [SSH contract](../../../../packages/contracts/src/fork/vault-ssh.ts),
  [key/trust service](../../../../apps/server/src/fork/vault/VaultSsh.ts) and
  [scoped SSH transport](../../../../apps/server/src/fork/vault/SshTransport.ts).
- [SSH protocol adapter](../../../../apps/server/src/fork/vault/SshCrypto.ts) and
  [disposable proof](../../../../apps/server/src/fork/vault/testkit/ssh_proof.py).
- [OpenSSH agent extensions](https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.agent)
  and [host-bound authentication implementation](https://github.com/openssh/openssh-portable/blob/master/sshconnect2.c):
  verified session binding and the signed user-authentication payload. RFC 4252 assigns message
  50 to SSH_MSG_USERAUTH_REQUEST; the independent real-client proof exercises that discriminator.

## Shared design and prior art

- [Shared foundation](../LOOM-VAULT-FOUNDATION.md): shared boundaries and backend selection.
- [Packet conventions](../CONVENTIONS.md): additive integration and focused verification.
- [Loom Vault decisions](../LOOM-VAULT.md#design-decisions-before-building): unsettled product choices.

External engines and specs in the foundation are evaluation references. No external code or
assets are copied. Kyle selected self-hosted OpenBao 2.7.1 (MPL 2.0) for the shared backend;
this packet adds no application dependency.
