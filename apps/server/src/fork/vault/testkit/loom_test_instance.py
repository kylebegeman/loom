"""Prepare, run and prove a dedicated loopback Loom target without personal credentials."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any
import urllib.error
import urllib.parse
import urllib.request
import uuid

REPOSITORY = Path(__file__).resolve().parents[6]
HOME_NAME = "vault-app-test"
MARKER = {"version": 1, "application": "Loom", "purpose": "vault-local-test-target"}
PROVIDERS = ("codex", "claudeAgent", "cursor", "grok", "muse", "pi", "opencode", "antigravity")
SETTINGS = {"providerInstances": {driver: {"driver": driver, "enabled": False} for driver in PROVIDERS}}


class InstanceError(Exception):
    """Only fixed, credential-free errors leave this harness."""


def isolated_environment(source: dict[str, str]) -> dict[str, str]:
    # An allowlist also excludes future credentials, relay enrollment and process-launch markers.
    names = ("HOME", "PATH", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SYSTEMROOT")
    env = {name: source[name] for name in names if name in source}
    env["PATH"] = str(REPOSITORY / "node_modules" / ".bin") + os.pathsep + env.get("PATH", "")
    env.update(T3CODE_RELEASE_PUBLIC_CONFIG="1", T3CODE_DEV_INSTANCE="1940",
               PYTHONDONTWRITEBYTECODE="1")
    return env


def instance_home(repository: Path) -> Path:
    root = repository.resolve(strict=True)
    home = root / ".t3" / HOME_NAME
    for path in (home.parent, home):
        if path.is_symlink() or (path.exists() and not path.is_dir()):
            raise InstanceError("The dedicated test home must not redirect to another location.")
    return home


def private_json(path: Path, value: object) -> None:
    # Never follow an existing symlink when writing fixture settings or markers.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, indent=2)
        stream.write("\n")


def read_json(path: Path) -> Any:
    if path.is_symlink():
        raise InstanceError("A test fixture file must not redirect to another location.")
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        raise InstanceError("The dedicated test fixture is missing or invalid.") from None


def run_node(repository: Path, args: list[str]) -> str:
    executable = shutil.which("node")
    if executable is None:
        raise InstanceError("The existing Node installation is required.")
    try:
        result = subprocess.run([executable, *args], cwd=repository,
                                env=isolated_environment(dict(os.environ)),
                                capture_output=True, text=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise InstanceError("A local Loom command did not finish; inspect the isolated target privately.") from None
    if result.returncode != 0:
        # Neither the command's output nor CalledProcessError may expose a minted credential.
        raise InstanceError("A local Loom command failed; no command output was disclosed.")
    return result.stdout


def initialize_git_fixture(home: Path) -> None:
    workspace = home / "fixtures" / "sample-project"
    for path in (home / "fixtures", workspace, workspace / ".git"):
        if path.is_symlink():
            raise InstanceError("The synthetic workspace must not redirect to another location.")
    if (workspace / ".git").exists():
        if not (workspace / ".git").is_dir():
            raise InstanceError("The synthetic workspace must have its own Git directory.")
        return
    env = isolated_environment(dict(os.environ))
    env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
    try:
        # An uninitialized directory would resolve Git operations to the enclosing checkout.
        result = subprocess.run(["git", "init", "--initial-branch=loom-test"], cwd=workspace,
                                env=env, capture_output=True, timeout=15, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise InstanceError("The synthetic Git repository could not be initialized.") from None
    if result.returncode != 0:
        raise InstanceError("The synthetic Git repository could not be initialized.")


def prepare(repository: Path) -> Path:
    home = instance_home(repository)
    if home.exists():
        if (home / "userdata" / "dev-fixture.json").exists():
            validate_home(repository, require_repository=False)
            initialize_git_fixture(home)
            validate_home(repository)
            return home
        # An interrupted first seed may be retried, but never adopt an unrelated directory.
        if read_json(home / "vault-test-instance.json") != MARKER or any(
                path.name != "vault-test-instance.json" for path in home.iterdir()):
            raise InstanceError("Refusing an incomplete or unrelated test directory.")
    else:
        home.mkdir(parents=True, mode=0o700)
        private_json(home / "vault-test-instance.json", MARKER)
    run_node(repository, ["apps/server/scripts/seed-dev-db.ts", "--base-dir", str(home),
                          "--scenario", "sample"])
    private_json(home / "userdata" / "settings.json", SETTINGS)
    initialize_git_fixture(home)
    validate_home(repository)
    return home


def validate_home(repository: Path, *, require_repository: bool = True) -> Path:
    home = instance_home(repository)
    if read_json(home / "vault-test-instance.json") != MARKER:
        raise InstanceError("Refusing a directory not created by this test-instance harness.")
    userdata = home / "userdata"
    if userdata.is_symlink():
        raise InstanceError("The dedicated test state must not redirect to another location.")
    if read_json(userdata / "dev-fixture.json") != {"version": 1, "scenario": "sample"}:
        raise InstanceError("The test target must contain only the seeded sample fixture.")
    settings = read_json(userdata / "settings.json")
    if (settings.get("providerInstances") != SETTINGS["providerInstances"]
            or settings.get("projectSettingsOverrides")):
        raise InstanceError("The isolated target settings changed; providers must remain disabled.")
    for name in ("statev2.sqlite", "statev2.sqlite-wal", "statev2.sqlite-shm", "environment-id"):
        if (userdata / name).is_symlink():
            raise InstanceError("The dedicated test state must not redirect to another location.")
    for path in (home / "fixtures", home / "fixtures" / "sample-project",
                 home / "fixtures" / "sample-project" / ".git"):
        if path.is_symlink():
            raise InstanceError("The synthetic workspace must not redirect to another location.")
    git_directory = home / "fixtures" / "sample-project" / ".git"
    if (require_repository or git_directory.exists()) and not git_directory.is_dir():
        raise InstanceError("The synthetic workspace must have its own Git directory.")
    return home


def loopback_origin(value: str) -> str:
    try:
        url = urllib.parse.urlsplit(value)
        port = url.port
    except (ValueError, TypeError):
        raise InstanceError("The target must have an explicit loopback HTTP origin.") from None
    if (url.scheme != "http" or url.hostname != "127.0.0.1" or port is None
            or not 1024 <= port <= 65535 or url.username is not None or url.password is not None
            or url.path not in ("", "/") or url.query or url.fragment):
        raise InstanceError("The target must have an explicit loopback HTTP origin.")
    return f"http://127.0.0.1:{port}"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str,
                         headers: Any, newurl: str) -> None:
        return None


def request(origin: str, path: str, token: str | None = None) -> tuple[int, Any]:
    headers = {"x-t3-orchestration-protocol": "2"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    # Ignore ambient proxies and refuse redirects, including redirects carrying Authorization.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(urllib.request.Request(origin + path, headers=headers), timeout=10) as response:
            return response.status, json.loads(response.read(2_000_000))
    except urllib.error.HTTPError as error:
        with error:
            return error.code, None
    except (OSError, ValueError):
        raise InstanceError("The isolated target did not return a valid response.") from None


def require(condition: bool, message: str) -> None:
    if not condition:
        raise InstanceError(message)


def prove(repository: Path) -> dict[str, object]:
    home = validate_home(repository)
    runtime = read_json(home / "userdata" / "server-runtime.json")
    origin = loopback_origin(runtime.get("origin", ""))
    status, descriptor = request(origin, "/.well-known/t3/environment")
    environment_id = (home / "userdata" / "environment-id").read_text().strip()
    require(status == 200 and descriptor.get("environmentId") == environment_id,
            "The listening target does not match the dedicated test environment.")
    status, _ = request(origin, "/api/orchestration/shell")
    require(status == 401, "The dedicated target unexpectedly permits unauthenticated access.")
    subject = "vault-test-proof:" + uuid.uuid4().hex

    def cli(*args: str) -> Any:
        output = run_node(repository, ["apps/server/src/bin.ts", "auth", "session", *args,
                                       "--base-dir", str(home)])
        return json.loads(output) if "--json" in args else None

    def issue() -> dict[str, Any]:
        value = cli("issue", "--json", "--ttl", "5m", "--subject", subject,
                    "--label", "Loom disposable test session", "--scope", "orchestration:read")
        require(isinstance(value, dict) and isinstance(value.get("token"), str)
                and isinstance(value.get("sessionId"), str) and value.get("subject") == subject
                and value.get("scopes") == ["orchestration:read"], "Unexpected test session response.")
        return value

    try:
        original = issue()
        status, shell = request(origin, "/api/orchestration/shell", original["token"])
        require(status == 200 and len(shell.get("threads", [])) == 3,
                "The issued test session cannot read the synthetic fixture.")
        require(all(thread.get("activeRunId") is None for thread in shell["threads"]),
                "The target has an active run; this proof requires stopped synthetic threads.")
        status, _ = request(origin, "/api/auth/clients", original["token"])
        require(status == 403, "The read-only test session unexpectedly permits access administration.")
        cli("revoke", original["sessionId"])
        status, _ = request(origin, "/api/orchestration/shell", original["token"])
        require(status == 401, "The revoked test credential still permits access.")
        replacement = issue()
        require(replacement["sessionId"] != original["sessionId"], "Reset reused the original session.")
        status, _ = request(origin, "/api/orchestration/shell", replacement["token"])
        require(status == 200, "The replacement test session cannot access the fixture.")
        status, _ = request(origin, "/api/orchestration/shell", original["token"])
        require(status == 401, "Replacement unexpectedly restored the revoked credential.")
    finally:
        # Query by this invocation's subject even if mint succeeded but its reply was lost.
        for session in cli("list", "--json"):
            if session.get("subject") == subject:
                cli("revoke", session["sessionId"])
        require(not any(session.get("subject") == subject for session in cli("list", "--json")),
                "Test-session cleanup is incomplete; do not treat the target as reset.")
    status, _ = request(origin, "/api/orchestration/shell", replacement["token"])
    require(status == 401, "Final cleanup did not revoke the replacement test session.")
    validate_home(repository)
    return {"application": "Loom", "target": origin, "provision": "passed", "reset": "passed",
            "oldCredentialRefused": True, "replacementWorks": True, "accessAdministrationRefused": True,
            "cleanup": "passed",
            "providersEnabled": False, "emailVerification": "not configured",
            "vaultLoginDelivery": "disabled"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "start", "prove"))
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            home = prepare(REPOSITORY)
            print(f"Prepared Loom test target at {home}; synthetic data and disabled providers.")
        elif args.command == "start":
            home = validate_home(REPOSITORY)
            os.chdir(REPOSITORY)
            executable = shutil.which("node")
            require(executable is not None, "The existing Node installation is required.")
            os.execve(str(executable), [str(executable), "scripts/dev-runner.ts", "dev",
                      "--home-dir", str(home), "--host", "127.0.0.1",
                      "--no-auto-bootstrap-project-from-cwd"], isolated_environment(dict(os.environ)))
        else:
            print(json.dumps(prove(REPOSITORY), indent=2))
    except InstanceError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, TypeError, AttributeError, KeyError):
        # Underlying provider/HTTP/CLI errors can contain credentials; do not dump their repr.
        print("Loom test-instance command failed. Inspect only this isolated fixture privately.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
