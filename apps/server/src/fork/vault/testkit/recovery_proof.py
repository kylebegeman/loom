"""Offline archive and isolated OpenBao snapshot/restore proof; synthetic data only.

Owns both loopback services and all files. Never accepts an existing server URL or home.
Run with PYTHONDONTWRITEBYTECODE=1 python3 <this-file> --bao /verified/path/to/bao.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request

from openbao_proof import Fixture, REPOSITORY


def denied(fixture: Fixture, token: str) -> bool:
    try:
        fixture.request("auth/token/lookup-self", token=token)
    except urllib.error.HTTPError as error:
        return error.code == 403
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bao", required=True, type=Path)
    args = parser.parse_args()
    binary = args.bao.resolve(strict=True)
    if "v2.7.1" not in subprocess.check_output([str(binary), "version"], text=True):
        raise RuntimeError("This isolated proof requires verified OpenBao 2.7.1")
    node = shutil.which("node")
    if node is None:
        raise RuntimeError("Node is required for the operator CLI")
    fixture: Fixture | None = None
    with tempfile.TemporaryDirectory(prefix="loom-vault-recovery-proof-") as temporary:
        root = Path(temporary).resolve()
        root.chmod(0o700)
        try:
            source = root / "source"
            source.mkdir(mode=0o700)
            fixture = Fixture(binary, source, source / "data")
            fixture.wait_started()
            initial = fixture.request("sys/init", {"secret_shares": 1, "secret_threshold": 1})
            token, key = initial["root_token"], initial["keys"][0]
            fixture.unseal(key)
            fixture.request("sys/mounts/loom", {"type": "kv", "options": {"version": "2"}}, token)
            service_file = root / "fixture-token"
            service_file.touch(mode=0o600)
            service_file.write_text(token)
            env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1",
                       LOOM_VAULT_TEST_OPENBAO_URL=fixture.origin,
                       LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE=str(service_file))
            env.pop("LOOM_VAULT_TEST_OPENBAO_RESTORE", None)
            tests = [str(REPOSITORY / "node_modules/.bin/vp"), "test", "run",
                     "src/fork/vault/OpenBaoStore.integration.test.ts"]
            subprocess.run(tests, cwd=REPOSITORY / "apps/server", env=env, check=True, timeout=90)
            identity = fixture.request("auth/token/create", {"policies": ["default"], "ttl": "1h"}, token)
            stale_token = identity["auth"]["client_token"]
            snapshot = root / "captured.snapshot"
            request = urllib.request.Request(fixture.origin + "/v1/sys/storage/raft/snapshot",
                                             headers={"Authorization": f"Bearer {token}"})
            with urllib.request.urlopen(request, timeout=15) as response, snapshot.open("xb") as output:
                snapshot.chmod(0o600)
                shutil.copyfileobj(response, output)
            recovery_key, archive = root / "recovery.key", root / "vault.archive"
            recovered = root / "recovered.snapshot"
            cli = [node, str(REPOSITORY / "apps/server/src/bin.ts"), "vault", "recovery"]
            # No backend or personal identity configuration is inherited by the offline commands.
            offline = {"PATH": "/usr/bin:/bin", "HOME": str(root), "NO_COLOR": "1"}

            def command(*arguments: str) -> str:
                result = subprocess.run([*cli, *arguments], cwd=root, env=offline,
                                        capture_output=True, text=True, timeout=45)
                if result.returncode != 0:
                    raise RuntimeError("Offline recovery CLI refused synthetic fixture")
                return result.stdout

            command("key-create", str(recovery_key))
            flags = ["--key-file", str(recovery_key), "--environment-id", "isolated-recovery-proof"]
            sealed = json.loads(command("seal", str(snapshot), str(archive), *flags))
            verified = json.loads(command("verify", str(archive), *flags))
            restored = json.loads(command("unseal", str(archive), str(recovered), *flags))
            assert sealed == verified == restored
            assert restored["authenticated"] is True
            assert restored["backendRestoreVerified"] is False and restored["canPromote"] is False
            assert hashlib.sha256(snapshot.read_bytes()).digest() == hashlib.sha256(recovered.read_bytes()).digest()
            fixture.request("auth/token/revoke", {"token": stale_token}, token)
            assert denied(fixture, stale_token), "Source must deny the post-snapshot revoked token"
            fixture.stop()
            fixture = None

            target = root / "target"
            target.mkdir(mode=0o700)
            fixture = Fixture(binary, target, target / "data")
            fixture.wait_started()
            target_init = fixture.request("sys/init", {"secret_shares": 1, "secret_threshold": 1})
            fixture.unseal(target_init["keys"][0])
            # Force is confined to this newly initialized throwaway backend. The source unseal
            # key is deliberately different; no production restore command is exposed by Loom.
            request = urllib.request.Request(fixture.origin + "/v1/sys/storage/raft/snapshot-force",
                                             data=recovered.read_bytes(), method="POST",
                                             headers={"Authorization": f"Bearer {target_init['root_token']}",
                                                      "Content-Type": "application/octet-stream"})
            with urllib.request.urlopen(request, timeout=20) as response:
                assert response.status == 204
            fixture.stop()
            fixture = None
            fixture = Fixture(binary, target, target / "data")
            fixture.wait_started()
            fixture.unseal(key)
            env.update(LOOM_VAULT_TEST_OPENBAO_URL=fixture.origin, LOOM_VAULT_TEST_OPENBAO_RESTORE="1")
            subprocess.run(tests, cwd=REPOSITORY / "apps/server", env=env, check=True, timeout=90)
            # An authenticated archive is not freshness evidence: the backend really restores
            # this formerly valid token. A separate authority barrier must keep it isolated.
            assert not denied(fixture, stale_token), "Old snapshot should exhibit the rollback hazard"
            fixture.request("auth/token/revoke", {"token": stale_token}, token)
            assert denied(fixture, stale_token), "Explicit revocation reconciliation must deny it"
            print("PASS: encrypted snapshot, isolated restore, preserved policy/CAS and post-snapshot revocation reconciliation; no promotion")
        finally:
            if fixture is not None:
                fixture.stop()


if __name__ == "__main__":
    main()
