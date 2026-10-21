# L88 testing

Status: offline encrypted archive acceptance passes locally. Full packet completion and
production trust promotion are not established.

## Verified evidence

From `apps/server`, `../../node_modules/.bin/vp test run src/fork/vault/RecoveryArchive.test.ts`
passes **20 tests** (19 POSIX cases and an explicit unsupported-platform refusal). Evidence covers a streamed binary round trip, private file modes,
wrong key/environment, header/ciphertext/tag tampering, truncation and trailing bytes,
pre-existing files, input/output symlinks, FIFO refusal without waiting for a writer, empty inputs and malformed independently encrypted
manifests, including unsupported version, invalid time, unsafe byte count, size and digest
mismatches, oversized and empty metadata. Actual CLI children run offline from a disposable
working directory through key creation, seal, verify, unseal and tampered refusal. Archive
bytes contain neither the synthetic secret canary nor environment/digest metadata in plaintext.
Failed authentication, including truncated unseal, publishes no recovered file and leaves no
ordinary-operation staging file. IPC-coordinated child tests hold a real staging write, send
SIGINT and verify exit 130 with no staging or output for unseal, seal and key-create. All three
fail against the previous tryPromise adapter. A child with unsupported hard-link publication
verifies the specific local-filesystem refusal, absence of private device error details and
staging cleanup; it fails against the previous generic refusal. No sleeps or large fixtures
are needed for these interruption tests.

The server scoped typecheck and changed-file lint pass. No client or wire contract changed.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 src/fork/vault/testkit/recovery_proof.py --bao /verified/path/to/bao
```

This separate proof passes with installed OpenBao **2.7.1**. It creates only disposable loopback
Raft services, seeds synthetic encrypted versions and revoked grants using the real integration
suite, captures a live Raft snapshot, encrypts/verifies/unseals through actual offline CLI
children and restores into a different newly initialized disposable backend. The real store
suite passes **2 initial plus 2 restored tests** (the other phase's 2 cases are skipped per run).
It proves version/value, grant revocation and decision-history preservation. It separately
revokes a synthetic OpenBao token after capture, demonstrates that the old snapshot revives
that token in isolation and verifies denial after explicit reconciliation. No promotion occurs.
Captured child processes stop in `finally`; private keys, storage and archives are removed.

## Remaining acceptance

- Independent durable revocation/authority barrier when the original host or latest log is lost.
- Production recovery custody, off-host destination, retention, acceptable data loss and recovery time.
- Consistent scheduled capture and its permissions, interrupted-host cleanup and real lost-device drill.
- Web, Electron, mobile and remote management; Windows filesystem boundary.
- Approved backend promotion and old-machine trust reconciliation.

The local archive receipt never claims these checks passed. Native acceptance remains with
the platform owner. No production service, Library change, installation or release was used.
