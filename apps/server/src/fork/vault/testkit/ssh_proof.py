"""Disposable loopback SSH + OpenBao proof. Never targets existing services or real keys."""
from __future__ import annotations
import argparse
from collections import deque
import getpass
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import sys
sys.dont_write_bytecode = True
from openbao_proof import Fixture, REPOSITORY, free_port


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bao", required=True, type=Path)
    args = parser.parse_args()
    binary = args.bao.resolve(strict=True)
    if "v2.7.1" not in subprocess.check_output([str(binary), "version"], text=True):
        raise RuntimeError("This disposable proof is pinned to OpenBao 2.7.1")
    with tempfile.TemporaryDirectory(prefix="loom-vault-ssh-proof-", dir="/private/tmp" if os.uname().sysname == "Darwin" else None) as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        fixture: Fixture | None = None
        sshd: subprocess.Popen[str] | None = None
        try:
            subprocess.run(["/usr/bin/ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / "host")], check=True)
            authorized = root / "authorized_keys"
            authorized.touch(mode=0o600)
            port = free_port()
            config = root / "sshd_config"
            config.write_text(
                f"Port {port}\nListenAddress 127.0.0.1\nHostKey {root / 'host'}\n"
                f"PidFile {root / 'sshd.pid'}\nAuthorizedKeysFile {authorized}\n"
                f"AllowUsers {getpass.getuser()}\nUsePAM no\nStrictModes no\n"
                "PasswordAuthentication no\nKbdInteractiveAuthentication no\n"
                "AuthenticationMethods publickey\nAllowAgentForwarding no\n"
                "AllowTcpForwarding no\nPermitTunnel no\nLogLevel VERBOSE\n"
            )
            sshd = subprocess.Popen(["/usr/sbin/sshd", "-D", "-e", "-f", str(config)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            ready = threading.Event()
            logs: deque[str] = deque(maxlen=30)
            def read_logs() -> None:
                assert sshd is not None and sshd.stdout is not None
                for line in sshd.stdout:
                    logs.append(line)
                    if "Server listening on" in line:
                        ready.set()
            reader = threading.Thread(target=read_logs, daemon=True)
            reader.start()
            if not ready.wait(10):
                raise RuntimeError("Disposable sshd failed to start:\n" + "".join(logs))
            fixture = Fixture(binary, root, root / "bao-data")
            fixture.wait_started()
            initial = fixture.request("sys/init", {"secret_shares": 1, "secret_threshold": 1})
            fixture.unseal(initial["keys"][0])
            token = initial["root_token"]
            fixture.request("sys/mounts/loom", {"type": "kv", "options": {"version": "2"}}, token)
            token_file = root / "service-token"
            token_file.touch(mode=0o600)
            token_file.write_text(token)
            environment = dict(os.environ,
                TMPDIR="/private/tmp" if os.uname().sysname == "Darwin" else tempfile.gettempdir(),
                LOOM_VAULT_TEST_OPENBAO_URL=fixture.origin,
                LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE=str(token_file),
                LOOM_VAULT_TEST_SSH_PORT=str(port),
                LOOM_VAULT_TEST_SSH_USER=getpass.getuser(),
                LOOM_VAULT_TEST_SSH_HOST_KEY=" ".join((root / "host.pub").read_text().split()[:2]),
                LOOM_VAULT_TEST_SSH_AUTHORIZED_KEYS=str(authorized),
            )
            subprocess.run([str(REPOSITORY / "node_modules/.bin/vp"), "test", "run", "apps/server/src/fork/vault/VaultSsh.integration.test.ts"], cwd=REPOSITORY, env=environment, check=True)
            fixture.stop()
            fixture = None
            for path in (root / "bao-data").rglob("*"):
                if path.is_file() and b"BEGIN PRIVATE KEY" in path.read_bytes():
                    raise AssertionError("Private key text found in persisted OpenBao storage")
            print("PASS: disposable SSH authentication, pinned trust, encrypted keys, revocation and cleanup")
        finally:
            if fixture is not None:
                fixture.stop()
            if sshd is not None:
                sshd.terminate()
                try:
                    sshd.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    sshd.kill()
                    sshd.wait(timeout=5)
                if sshd.stdout is not None:
                    sshd.stdout.close()


if __name__ == "__main__":
    main()
