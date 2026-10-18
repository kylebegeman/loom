"""Disposable OpenBao 2.7.1 integration proof. Never targets an existing service.

Run from any directory: python3 <this-file> --bao /absolute/path/to/bao
Uses only Python's standard library, a local OpenBao binary, and installed repo tools.
"""
from __future__ import annotations

import argparse
from collections import deque
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
from typing import Any
import urllib.request

REPOSITORY = Path(__file__).resolve().parents[6]
CANARY = b"synthetic-backup-recovery-canary"


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


class Fixture:
    def __init__(self, binary: Path, root: Path, data: Path) -> None:
        api_port, cluster_port = free_port(), free_port()
        self.origin = f"http://127.0.0.1:{api_port}"
        self.active = threading.Event()
        self.ready = threading.Event()
        self.started = threading.Event()
        self.logs: deque[str] = deque(maxlen=30)
        config = root / "config.hcl"
        config.write_text(
            f'api_addr = "{self.origin}"\n'
            f'cluster_addr = "https://127.0.0.1:{cluster_port}"\n'
            'listener "tcp" {\n'
            f'  address = "127.0.0.1:{api_port}"\n'
            f'  cluster_address = "127.0.0.1:{cluster_port}"\n'
            '  tls_disable = true\n}\n'
            f'storage "raft" {{\n  path = "{data}"\n  node_id = "integration-node"\n}}\n'
        )
        self.process = subprocess.Popen(
            [str(binary), "server", f"-config={config}"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        self.reader = threading.Thread(target=self._read_logs, daemon=True)
        self.reader.start()

    def _read_logs(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.logs.append(line)
            if "server started!" in line:
                self.started.set()
            if "acquired lock, enabling active operation" in line:
                self.active.set()
            if "post-unseal setup complete" in line and self.active.is_set():
                self.ready.set()

    def wait_started(self) -> None:
        if not self.started.wait(20):
            raise RuntimeError("OpenBao startup failed:\n" + "".join(self.logs))

    def request(self, path: str, body: dict[str, Any] | None = None,
                token: str | None = None) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        method = "PUT" if path in ("sys/init", "sys/unseal") else "GET" if body is None else "POST"
        request = urllib.request.Request(
            self.origin + "/v1/" + path,
            data=None if body is None else json.dumps(body).encode(),
            headers=headers, method=method,
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read() or b"{}")

    def unseal(self, key: str) -> None:
        # Initialization can emit an earlier setup event before actual unsealing.
        self.ready.clear()
        self.active.clear()
        self.request("sys/unseal", {"key": key})
        if not self.ready.wait(20):
            raise RuntimeError("OpenBao did not finish active leadership setup")

    def stop(self) -> None:
        self.process.terminate()
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.reader.join(timeout=5)
        if self.process.stdout is not None:
            self.process.stdout.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bao", required=True, type=Path)
    args = parser.parse_args()
    binary = args.bao.resolve(strict=True)
    version = subprocess.check_output([str(binary), "version"], text=True)
    if "v2.7.1" not in version:
        raise RuntimeError("This proof is pinned to OpenBao 2.7.1; verify newer releases explicitly")
    test_command = [str(REPOSITORY / "node_modules/.bin/vp"), "test", "run",
                    "apps/server/src/fork/vault/OpenBaoStore.integration.test.ts"]
    fixture: Fixture | None = None
    with tempfile.TemporaryDirectory(prefix="loom-vault-openbao-") as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        try:
            data = root / "data"
            fixture = Fixture(binary, root, data)
            fixture.wait_started()
            initial = fixture.request("sys/init", {"secret_shares": 1, "secret_threshold": 1})
            token, key = initial["root_token"], initial["keys"][0]
            fixture.unseal(key)
            fixture.request("sys/mounts/loom", {"type": "kv", "options": {"version": "2"}}, token)
            token_file = root / "service-token"
            token_file.touch(mode=0o600)
            token_file.write_text(token)
            environment = dict(os.environ, LOOM_VAULT_TEST_OPENBAO_URL=fixture.origin,
                               LOOM_VAULT_TEST_OPENBAO_TOKEN_FILE=str(token_file))
            environment.pop("LOOM_VAULT_TEST_OPENBAO_RESTORE", None)
            subprocess.run(test_command, cwd=REPOSITORY, env=environment, check=True)
            fixture.stop()
            fixture = None
            for path in data.rglob("*"):
                if path.is_file() and CANARY in path.read_bytes():
                    raise AssertionError("Synthetic plaintext found in persisted Raft storage")
            # A consistent stopped copy demonstrates fixture portability. Production uses
            # the operator's approved Raft snapshot and independently protected recovery keys.
            backup, restored = root / "backup", root / "restored"
            shutil.copytree(data, backup)
            shutil.copytree(backup, restored)
            fixture = Fixture(binary, root, restored)
            fixture.wait_started()
            fixture.unseal(key)
            environment.update(LOOM_VAULT_TEST_OPENBAO_URL=fixture.origin,
                               LOOM_VAULT_TEST_OPENBAO_RESTORE="1")
            subprocess.run(test_command, cwd=REPOSITORY, env=environment, check=True)
            print("PASS: real OpenBao CAS, encrypted persistence and clean restore with synthetic records")
        finally:
            if fixture is not None:
                fixture.stop()


if __name__ == "__main__":
    main()
