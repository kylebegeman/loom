"""Prove the gated journal using only the documented minimal policy in disposable OpenBao."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

from openbao_proof import Fixture, REPOSITORY


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bao", required=True, type=Path)
    args = parser.parse_args()
    binary = args.bao.resolve(strict=True)
    if "v2.7.1" not in subprocess.check_output([str(binary), "version"], text=True):
        raise RuntimeError("This proof is pinned to OpenBao 2.7.1")
    namespace = hashlib.sha256(b"journal-integration-proof").hexdigest()
    fixture: Fixture | None = None
    with tempfile.TemporaryDirectory(prefix="loom-journal-proof-") as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        try:
            fixture = Fixture(binary, root, root / "data")
            fixture.wait_started()
            initial = fixture.request("sys/init", {"secret_shares": 1, "secret_threshold": 1})
            fixture.unseal(initial["keys"][0])
            admin = initial["root_token"]
            fixture.request("sys/mounts/loom", {"type": "kv", "options": {"version": "2"}}, admin)
            # Exact minimal rights documented in operations/vault.md, without a journal grant.
            policy = 'path "loom/config" { capabilities = ["read"] }\n'
            for suffix in ("items/*", "access-policy", "brokers", "profiles/*"):
                policy += f'path "loom/data/environments/{namespace}/{suffix}" {{ capabilities = ["read", "create", "update"] }}\n'
            policy += f'path "loom/metadata/environments/{namespace}/items" {{ capabilities = ["list"] }}\n'
            fixture.request("sys/policies/acl/existing-minimal", {"policy": policy}, admin)
            service = fixture.request("auth/token/create", {"policies": ["existing-minimal"], "no_default_policy": True}, admin)
            token_file = root / "service-token"
            token_file.touch(mode=0o600)
            token_file.write_text(service["auth"]["client_token"])
            environment = dict(os.environ, LOOM_VAULT_TEST_JOURNAL_URL=fixture.origin,
                               LOOM_VAULT_TEST_JOURNAL_TOKEN_FILE=str(token_file),
                               PYTHONDONTWRITEBYTECODE="1")
            environment.pop("LOOM_VAULT_TEST_JOURNAL_RESTART", None)
            command = [str(REPOSITORY / "node_modules/.bin/vp"), "test", "run",
                       "src/fork/vault/OperationJournal.integration.test.ts"]
            subprocess.run(command, cwd=REPOSITORY / "apps/server", env=environment, check=True, timeout=90)
            maintenance = [str(REPOSITORY / "node_modules/.bin/vp"), "test", "run",
                           "src/fork/vault/MaintenanceLedgers.integration.test.ts"]
            subprocess.run(maintenance, cwd=REPOSITORY / "apps/server", env=environment, check=True, timeout=90)
            for name in ("cleanup-reset-v1", "credential-lifecycle-v1"):
                record = fixture.request(f"loom/data/environments/{namespace}/profiles/_operations/{name}", token=service["auth"]["client_token"])
                assert record["data"]["data"]["loomVaultEncoding"] == "json-v1"
            fixture.stop()
            fixture = None
            fixture = Fixture(binary, root, root / "data")
            fixture.wait_started()
            fixture.unseal(initial["keys"][0])
            environment.update(LOOM_VAULT_TEST_JOURNAL_URL=fixture.origin,
                               LOOM_VAULT_TEST_JOURNAL_RESTART="1")
            subprocess.run(command, cwd=REPOSITORY / "apps/server", env=environment, check=True, timeout=90)
            subprocess.run(maintenance, cwd=REPOSITORY / "apps/server", env=environment, check=True, timeout=90)
            print("PASS: maintenance ledgers and minimal scoped policy, CAS, denied sibling, format-3 compatibility and durable unknown/revocation after backend restart")
        finally:
            if fixture is not None:
                fixture.stop()


if __name__ == "__main__":
    main()
