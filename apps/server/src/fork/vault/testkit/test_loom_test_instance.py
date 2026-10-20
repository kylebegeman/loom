"""Isolation and failure proofs for the operator-only Loom test target harness."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

import loom_test_instance as target


class TestLoomInstance(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="loom-target-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.home = self.root / ".t3" / target.HOME_NAME
        self.home.mkdir(parents=True, mode=0o700)
        self.userdata = self.home / "userdata"
        self.userdata.mkdir()
        self.workspace = self.home / "fixtures" / "sample-project"
        self.workspace.mkdir(parents=True)
        target.initialize_git_fixture(self.home)
        target.private_json(self.home / "vault-test-instance.json", target.MARKER)
        target.private_json(self.userdata / "dev-fixture.json", {"version": 1, "scenario": "sample"})
        target.private_json(self.userdata / "settings.json", target.SETTINGS)
        target.private_json(self.userdata / "server-runtime.json", {"origin": "http://127.0.0.1:15713", "pid": 0})
        (self.userdata / "environment-id").write_text("fixture-environment")

    def test_existing_fixture_is_preserved_and_defaults_do_not_enable_providers(self) -> None:
        (self.userdata / "statev2.sqlite").write_bytes(b"existing-fixture-canary")
        with patch.object(target, "run_node") as run:
            self.assertEqual(target.prepare(self.root), self.home)
            run.assert_not_called()
        self.assertEqual((self.userdata / "statev2.sqlite").read_bytes(), b"existing-fixture-canary")
        target.private_json(self.userdata / "settings.json", dict(target.SETTINGS, projectSettingsFolded={}))
        self.assertEqual(target.validate_home(self.root), self.home)
        for settings in (
            {"providerInstances": {}},
            {"providerInstances": dict(target.SETTINGS["providerInstances"], other={"driver": "codex"})},
            dict(target.SETTINGS, projectSettingsOverrides={"p": {"providerInstances": {"codex": {"enabled": True}}}}),
        ):
            target.private_json(self.userdata / "settings.json", settings)
            with self.assertRaises(target.InstanceError):
                target.validate_home(self.root)

    def test_refuses_unmarked_state_and_redirected_userdata_without_writing(self) -> None:
        marker = self.home / "vault-test-instance.json"
        marker.unlink()
        with patch.object(target, "run_node") as run:
            with self.assertRaises(target.InstanceError):
                target.prepare(self.root)
            run.assert_not_called()
        target.private_json(marker, target.MARKER)
        real_userdata = self.home / "unrelated"
        self.userdata.rename(real_userdata)
        self.userdata.symlink_to(real_userdata, target_is_directory=True)
        with self.assertRaises(target.InstanceError):
            target.validate_home(self.root)

    def test_refuses_redirected_home_and_database(self) -> None:
        database = self.userdata / "statev2.sqlite"
        unrelated = self.root / "unrelated-state"
        unrelated.write_bytes(b"do-not-touch")
        database.symlink_to(unrelated)
        with self.assertRaises(target.InstanceError):
            target.validate_home(self.root)
        database.unlink()
        renamed_home = self.root / "elsewhere"
        self.home.rename(renamed_home)
        self.home.symlink_to(renamed_home, target_is_directory=True)
        with self.assertRaises(target.InstanceError):
            target.prepare(self.root)
        self.assertEqual(unrelated.read_bytes(), b"do-not-touch")

    def test_synthetic_workspace_has_its_own_git_root_without_personal_config(self) -> None:
        shutil.rmtree(self.workspace / ".git")
        env = target.isolated_environment(dict(target.os.environ), self.home)
        env.update(GIT_CONFIG_GLOBAL=target.os.devnull, GIT_CONFIG_NOSYSTEM="1")
        subprocess.run(["git", "init", "--initial-branch=parent-test"], cwd=self.root,
                       env=env, capture_output=True, check=True)
        target.initialize_git_fixture(self.home)
        result = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=self.workspace,
                                env=env, capture_output=True, text=True, check=True)
        self.assertEqual(Path(result.stdout.strip()).resolve(), self.workspace.resolve())
        self.assertNotIn("remote ", (self.workspace / ".git" / "config").read_text())

    def test_missing_git_boundary_and_redirecting_git_file_refuse(self) -> None:
        git_directory = self.workspace / ".git"
        shutil.rmtree(git_directory)
        with self.assertRaises(target.InstanceError):
            target.validate_home(self.root)
        git_directory.write_text("gitdir: /unrelated/checkout")
        with self.assertRaises(target.InstanceError):
            target.initialize_git_fixture(self.home)
        with self.assertRaises(target.InstanceError):
            target.validate_home(self.root)
        self.assertEqual(git_directory.read_text(), "gitdir: /unrelated/checkout")

    def test_partial_git_directory_and_missing_head_refuse_prepare_and_start_validation(self) -> None:
        env = target.isolated_environment(dict(target.os.environ), self.home)
        subprocess.run(["git", "init", "--initial-branch=outer"], cwd=self.root,
                       env=env, capture_output=True, check=True)
        git_directory = self.workspace / ".git"
        for partial in ("empty", "missing-head"):
            shutil.rmtree(git_directory)
            if partial == "empty":
                git_directory.mkdir()
            else:
                subprocess.run(["git", "init", "--initial-branch=partial"], cwd=self.workspace,
                               env=env, capture_output=True, check=True)
                (git_directory / "HEAD").unlink()
            with self.subTest(partial=partial):
                with self.assertRaisesRegex(target.InstanceError, "Git boundary"):
                    target.prepare(self.root)
                with self.assertRaisesRegex(target.InstanceError, "Git boundary"):
                    target.validate_home(self.root)

    def test_start_child_env_is_sandboxed_without_changing_the_parent_home(self) -> None:
        source_home = target.os.environ.get("HOME")
        with patch.object(target, "REPOSITORY", self.root), \
             patch.object(target.sys, "argv", ["loom_test_instance.py", "start"]), \
             patch.object(target.os, "chdir"), patch.object(target.os, "execve") as execute:
            target.main()
        env = execute.call_args.args[2]
        sandbox = self.home / "sandbox-home"
        self.assertEqual(env["HOME"], str(sandbox))
        self.assertEqual(env["XDG_CONFIG_HOME"], str(sandbox / ".config"))
        self.assertEqual(env["GH_CONFIG_DIR"], str(sandbox / ".config" / "gh"))
        self.assertEqual(env["GIT_CONFIG_GLOBAL"], str(sandbox / ".gitconfig"))
        self.assertEqual(env["GIT_CONFIG_NOSYSTEM"], "1")
        self.assertEqual(env["GIT_TERMINAL_PROMPT"], "0")
        self.assertEqual(env["GIT_CEILING_DIRECTORIES"], str(self.workspace.parent))
        self.assertEqual(target.os.environ.get("HOME"), source_home)

    def test_empty_userdata_and_leftover_seed_files_are_retryable(self) -> None:
        for child in self.userdata.iterdir():
            child.unlink()
        leftover = self.userdata / "seed-interrupted.sqlite"
        leftover.write_bytes(b"partial-seed-canary")

        def seed(repository: Path, args: list[str]) -> str:
            self.assertEqual(target.read_json(self.userdata / "settings.json"), target.SETTINGS)
            self.assertIn("sharedHome", args[2])
            self.assertEqual(Path(args[-1]), Path(target.pwd.getpwuid(target.os.getuid()).pw_dir).resolve() / ".t3")
            self.assertNotEqual(Path(args[-1]), self.home / "sandbox-home" / ".t3")
            target.private_json(self.userdata / "dev-fixture.json", {"version": 1, "scenario": "sample"})
            (self.userdata / "statev2.sqlite").write_bytes(b"complete-synthetic-seed")
            return ""
        with patch.object(target, "run_node", side_effect=seed):
            self.assertEqual(target.prepare(self.root), self.home)
        self.assertEqual(leftover.read_bytes(), b"partial-seed-canary")

    def test_published_fixture_missing_settings_is_repaired_before_validation(self) -> None:
        (self.userdata / "settings.json").unlink()
        with patch.object(target, "run_node") as seed:
            self.assertEqual(target.prepare(self.root), self.home)
            seed.assert_not_called()
        self.assertEqual(target.read_json(self.userdata / "settings.json"), target.SETTINGS)

    def test_unmarked_published_database_is_preserved_before_reseeding(self) -> None:
        (self.userdata / "dev-fixture.json").unlink()
        (self.userdata / "statev2.sqlite").write_bytes(b"unmarked-seed-canary")

        def seed(repository: Path, args: list[str]) -> str:
            target.private_json(self.userdata / "dev-fixture.json", {"version": 1, "scenario": "sample"})
            (self.userdata / "statev2.sqlite").write_bytes(b"complete-synthetic-seed")
            return ""
        with patch.object(target, "run_node", side_effect=seed):
            target.prepare(self.root)
        archives = list((self.home / "incomplete-seeds").glob("*/statev2.sqlite"))
        self.assertEqual(len(archives), 1)
        self.assertEqual(archives[0].read_bytes(), b"unmarked-seed-canary")
        self.assertEqual((self.userdata / "statev2.sqlite").read_bytes(), b"complete-synthetic-seed")

    def test_preparation_refuses_a_live_instance_before_changing_settings(self) -> None:
        target.private_json(self.userdata / "server-runtime.json", {"pid": target.os.getpid()})
        (self.userdata / "settings.json").unlink()
        with patch.object(target, "run_node") as seed:
            with self.assertRaisesRegex(target.InstanceError, "Stop the dedicated"):
                target.prepare(self.root)
            seed.assert_not_called()
        self.assertFalse((self.userdata / "settings.json").exists())

    def test_private_writes_refuse_symlinks_and_keep_owner_only_permissions(self) -> None:
        path = self.home / "private.json"
        target.private_json(path, {"fixture": True})
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        linked = self.home / "linked.json"
        linked.symlink_to(path)
        with self.assertRaises(OSError):
            target.private_json(linked, {"fixture": False})
        self.assertEqual(target.read_json(path), {"fixture": True})

    def test_child_environment_drops_personal_identity_and_repo_env_loading(self) -> None:
        env = target.isolated_environment({"HOME": "/Users/example", "PATH": "/usr/bin",
            "T3CODE_HOME": "/personal", "T3CODE_DEV_AUTH_TOKEN": "personal",
            "LOOM_IDENTITY_CLIENT_SECRET": "personal", "LOOM_VAULT_OPENBAO_TOKEN_FILE": "/personal",
            "SSH_AUTH_SOCK": "/personal", "HTTPS_PROXY": "https://personal",
            "T3_ACP_MCP_TOKEN": "personal", "NODE_OPTIONS": "--require=personal",
            "VITE_HTTP_URL": "https://personal", "UNKNOWN_FUTURE_SECRET": "personal"}, self.home)
        self.assertEqual(env["HOME"], str(self.home / "sandbox-home"))
        self.assertEqual(env["T3CODE_RELEASE_PUBLIC_CONFIG"], "1")
        self.assertNotIn("personal", json.dumps(env))
        self.assertTrue(env["PATH"].startswith(str(target.REPOSITORY / "node_modules" / ".bin")))

    def test_remote_credentialed_and_noncanonical_origins_refuse(self) -> None:
        self.assertEqual(target.loopback_origin("http://127.0.0.1:15713/"), "http://127.0.0.1:15713")
        for origin in ("https://loom.begam.in", "http://0.0.0.0:15713", "http://localhost:15713",
                       "http://127.0.0.1:80", "http://127.0.0.1:15713/path",
                       "http://user:password@127.0.0.1:15713", "http://127.0.0.1:15713?token=secret",
                       "http://127.0.0.1:15713#secret", "http://127.0.0.1:bad"):
            with self.subTest(origin=origin), self.assertRaises(target.InstanceError):
                target.loopback_origin(origin)

    def test_command_failure_never_discloses_output(self) -> None:
        failed = subprocess.CompletedProcess(["node"], 1, "secret-canary", "secret-canary")
        with patch.object(target.subprocess, "run", return_value=failed):
            with self.assertRaises(target.InstanceError) as error:
                target.run_node(self.root, ["unused"])
        self.assertNotIn("secret-canary", str(error.exception))
        self.assertIsNone(error.exception.__cause__)

    def auth_fixture(self, *, lose_mint: bool = False, restore_old: bool = False):
        sessions = {"unrelated": {"sessionId": "unrelated", "subject": "another-run"}}
        issued: list[dict[str, object]] = []
        revoked: list[str] = []

        def cli(repository: Path, args: list[str]) -> str:
            self.assertEqual(repository, self.root)
            self.assertEqual(args[-2:], ["--base-dir", str(self.home)])
            operation = args[3]
            if operation == "issue":
                self.assertEqual(args[args.index("--scope") + 1], "orchestration:read")
                self.assertEqual(args[args.index("--ttl") + 1], "5m")
                value = {"sessionId": "s" + str(len(issued)), "token": "secret-canary-" + str(len(issued)),
                         "subject": args[args.index("--subject") + 1], "scopes": ["orchestration:read"]}
                issued.append(value)
                sessions[str(value["sessionId"])] = value
                if lose_mint:
                    raise target.InstanceError("Synthetic lost mint reply.")
                return json.dumps(value)
            if operation == "list":
                return json.dumps(list(sessions.values()))
            if operation == "revoke":
                revoked.append(args[4])
                sessions.pop(args[4], None)
                return "revoked"
            self.fail("Unexpected authentication command")

        def http(origin: str, path: str, token: str | None = None):
            self.assertEqual(origin, "http://127.0.0.1:15713")
            if path == "/.well-known/t3/environment":
                return 200, {"environmentId": "fixture-environment"}
            if path == "/api/auth/clients":
                return 403, None
            valid = any(value.get("token") == token and token is not None for value in sessions.values())
            if restore_old and len(issued) == 2 and token == issued[0]["token"]:
                valid = True
            return (200, {"threads": [{"activeRunId": None}] * 3}) if valid else (401, None)
        return cli, http, sessions, issued, revoked

    def test_provision_reset_and_cleanup_use_only_scoped_disposable_sessions(self) -> None:
        cli, http, sessions, issued, revoked = self.auth_fixture()
        with patch.object(target, "run_node", side_effect=cli), patch.object(target, "request", side_effect=http):
            report = target.prove(self.root)
        self.assertEqual(report["cleanup"], "passed")
        self.assertEqual(report["vaultLoginDelivery"], "disabled")
        self.assertEqual(set(sessions), {"unrelated"})
        self.assertEqual(revoked, ["s0", "s1"])
        self.assertNotEqual(issued[0]["sessionId"], issued[1]["sessionId"])
        self.assertNotIn("secret-canary", json.dumps(report))

    def rejected_proof(self, mutate) -> None:
        cli, http, sessions, issued, revoked = self.auth_fixture()

        def changed(origin, path, token=None):
            return mutate(path, token, http(origin, path, token), issued, revoked)
        with patch.object(target, "run_node", side_effect=cli), patch.object(target, "request", side_effect=changed):
            with self.assertRaises(target.InstanceError):
                target.prove(self.root)
        self.assertEqual(set(sessions), {"unrelated"})

    def test_proof_rejects_unauthenticated_success(self) -> None:
        self.rejected_proof(lambda path, token, response, issued, revoked:
                            (200, {"threads": []}) if path.endswith("/shell") and token is None else response)

    def test_proof_rejects_access_administration_success(self) -> None:
        self.rejected_proof(lambda path, token, response, issued, revoked:
                            (200, []) if path.endswith("/clients") else response)

    def test_proof_rejects_the_wrong_fixture_thread_count(self) -> None:
        self.rejected_proof(lambda path, token, response, issued, revoked:
                            (200, {"threads": [{"activeRunId": None}] * 2})
                            if path.endswith("/shell") and response[0] == 200 else response)

    def test_proof_rejects_an_active_fixture_run(self) -> None:
        self.rejected_proof(lambda path, token, response, issued, revoked:
                            (200, {"threads": [{"activeRunId": "unexpected-live-run"}] * 3})
                            if path.endswith("/shell") and response[0] == 200 else response)

    def test_proof_rejects_access_with_the_just_revoked_original(self) -> None:
        self.rejected_proof(lambda path, token, response, issued, revoked:
                            (200, {}) if path.endswith("/shell") and token == "secret-canary-0"
                            and "s0" in revoked and len(issued) == 1 else response)

    def test_proof_rejects_replacement_access_after_final_cleanup(self) -> None:
        self.rejected_proof(lambda path, token, response, issued, revoked:
                            (200, {}) if path.endswith("/shell") and token == "secret-canary-1"
                            and "s1" in revoked else response)

    def test_lost_mint_reply_is_reconciled_by_invocation_subject(self) -> None:
        cli, http, sessions, _, revoked = self.auth_fixture(lose_mint=True)
        with patch.object(target, "run_node", side_effect=cli), patch.object(target, "request", side_effect=http):
            with self.assertRaisesRegex(target.InstanceError, "Synthetic lost mint reply"):
                target.prove(self.root)
        self.assertEqual(set(sessions), {"unrelated"})
        self.assertEqual(revoked, ["s0"])

    def test_reset_that_restores_old_access_fails_and_still_cleans_up(self) -> None:
        cli, http, sessions, _, revoked = self.auth_fixture(restore_old=True)
        with patch.object(target, "run_node", side_effect=cli), patch.object(target, "request", side_effect=http):
            with self.assertRaisesRegex(target.InstanceError, "restored the revoked"):
                target.prove(self.root)
        self.assertEqual(set(sessions), {"unrelated"})
        self.assertEqual(revoked, ["s0", "s1"])

    def test_mismatched_environment_is_rejected_before_issuing_any_session(self) -> None:
        with patch.object(target, "run_node") as run, patch.object(target, "request", return_value=(200, {"environmentId": "other"})):
            with self.assertRaisesRegex(target.InstanceError, "does not match"):
                target.prove(self.root)
            run.assert_not_called()

    def test_redirects_are_not_followed_even_with_ambient_proxy(self) -> None:
        paths: list[str] = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                paths.append(self.path)
                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header("Location", "/final")
                else:
                    self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{}')

            def log_message(self, format: str, *args: object) -> None:
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            with patch.dict(target.os.environ, {"http_proxy": "http://127.0.0.1:1", "no_proxy": ""}):
                status, _ = target.request(f"http://127.0.0.1:{server.server_port}", "/redirect", "fixture-token")
            self.assertEqual(status, 302)
            self.assertEqual(paths, ["/redirect"])
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_cleanup_failure_cannot_report_success(self) -> None:
        cli, http, _, _, _ = self.auth_fixture()

        def failed_cleanup(repository: Path, args: list[str]) -> str:
            if args[3] == "revoke" and args[4] == "s1":
                raise target.InstanceError("Synthetic cleanup failure.")
            return cli(repository, args)

        with patch.object(target, "run_node", side_effect=failed_cleanup), patch.object(target, "request", side_effect=http):
            with self.assertRaisesRegex(target.InstanceError, "cleanup failure"):
                target.prove(self.root)


if __name__ == "__main__":
    unittest.main()
