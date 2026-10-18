# L81 testing

Status: the mediated SSH milestone is verified against disposable OpenSSH and OpenBao services;
complete packet acceptance remains pending.

## Focused automated behavior

`SshCrypto.test.ts` independently constructs host-bound agent frames and verifies real Ed25519
signatures. Generic signing, wrong users/identities/host pins, unbound sessions, forged host
signatures and forwarding fail. `VaultSsh.test.ts` uses real core/policy/broker/workload services
with an in-memory backend and a controlled transport. It covers idempotent generation/trust,
CAS conflicts, trust removal/restoration, command tampering/replay, archive/restore, permission
reduction, grant changes, disabled hosts, bounded concurrency and cancellation permit recovery.

The same tests exercise authenticated MCP administration and signed runner/HTTP requests:
threads/read-only clients cannot generate keys or approve host trust, inspection requires its
own grant, HTTP execution carries no administrator bearer token, tampered result bindings fail
and revoked grants are rechecked. Existing host/workload/MCP regression tests remain required.
Targeted contracts/server/client-runtime/web/mobile typechecks and changed-file lint pass.
Focused runs cover 43 distinct tests across 11 files: the 27-test combined regression run,
21-test lifecycle/access run (overlapping the SSH service file), final eight-test service rerun
and two real integration tests. CLI help, the seam manifest, Python syntax and 237 changed-doc
local links also pass. No repository-wide suite was run.

## Real disposable proof

Run the following with the previously verified official OpenBao 2.7.1 binary:

```sh
python3 apps/server/src/fork/vault/testkit/ssh_proof.py --bao /absolute/path/to/bao
```

The fixture creates a loopback OpenSSH host with a synthetic host key and authorized-keys file,
and a separate initialized/unsealed KV v2 OpenBao. `VaultSsh.integration.test.ts` uses real key,
policy, enrollment, heartbeat and workload services. It registers only a synthetic public key
on that disposable host, authenticates repeatedly, checks exact argv quoting, denies a wrong
host pin and a fresh grant revocation, and verifies public-file/socket cleanup. A separate real
transport test covers timeout, output bounds, a policy denial after initial admission and
cancellation. The stopped Raft files are checked for private-key text. The fixture stops only
its own processes and removes its temporary data. It never reads personal SSH credentials.

No new web/mobile control was added this cycle, so browser/device interaction was not repeated.
Native Windows/Linux execution, actual provider launch/Git access, real VPS routing, relay
headless authentication and production restart/recovery are not verified by this macOS proof.
Remote effects may survive timeout or disconnect. No production registration or deployment ran.

## Remaining full acceptance

- Build and verify the selected web/desktop/mobile key and trust workflows, including focus,
  empty/error states, narrow layouts, permission gating and every reverse action.
- Exercise Git fetch repeatedly through Pi, another provider and scheduled tasks without a
  personal key manager; verify runtime launch attachment, cancellation and restart behavior.
- Verify chosen OS boundaries, imports/algorithms and Windows support or explicit unsupported
  behavior on real Windows; exercise remote/relay/tunnel matrices and skewed capabilities.
- Verify provider-side registration/revocation reconciliation and production custody/recovery.

## Merge safety

The implementation uses fork-owned paths and existing registries, with no new upstream seam.
Source commit `44adff693f` previews cleanly against the newest local upstream nightly,
`v0.1.1-nightly.20261017.3238`, using `git merge-tree --write-tree --name-only --no-messages`.
Full post-landing rehearsal remains a separate integration check. No fetch, landing, push,
production registration or deployment was performed.
