"""Isolation and failure proofs for the operator-only Loom test target harness."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
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

    def test_owned_interrupted_git_init_is_repaired_only_on_prepare(self) -> None:
        git_directory = self.workspace / ".git"
        for partial in ("empty", "missing-head"):
            with self.subTest(partial=partial):
                if partial == "empty":
                    shutil.rmtree(git_directory)
                    git_directory.mkdir()
                else:
                    (git_directory / "HEAD").unlink()
                with self.assertRaises(target.InstanceError):
                    target.validate_home(self.root)
                self.assertEqual(target.prepare(self.root), self.home)
                target.require_git_boundary(self.home)
                self.assertTrue((git_directory / "HEAD").is_file())

    def test_unowned_interrupted_git_init_is_not_adopted(self) -> None:
        (self.home / "git-fixture-owner.json").unlink()
        (self.workspace / ".git" / "HEAD").unlink()
        with self.assertRaises(target.InstanceError):
            target.initialize_git_fixture(self.home)
        self.assertFalse((self.workspace / ".git" / "HEAD").exists())

    def test_git_boundary_refuses_core_worktree_escape(self) -> None:
        escaped = self.root / "other-worktree"
        escaped.mkdir()
        with (self.workspace / ".git" / "config").open("a") as config:
            config.write("\n[core]\n\tworktree = " + str(escaped) + "\n")
        for check in (lambda: target.prepare(self.root), lambda: target.validate_home(self.root)):
            with self.assertRaises(target.InstanceError):
                check()

    def test_git_boundary_refuses_foreign_git_directory_result(self) -> None:
        result = subprocess.CompletedProcess(["git"], 0,
            "\n".join((str(self.workspace), str(self.root / "foreign-git"), str(self.workspace / ".git"))) + "\n", "")
        with patch.object(target.subprocess, "run", return_value=result):
            with self.assertRaises(target.InstanceError):
                target.require_git_boundary(self.home)

    def test_git_boundary_refuses_foreign_common_directory(self) -> None:
        foreign = self.root / "foreign"
        foreign.mkdir()
        subprocess.run(["git", "init", "--initial-branch=outer", str(foreign)],
                       env=target.isolated_environment(dict(target.os.environ), self.home),
                       capture_output=True, check=True)
        (self.workspace / ".git" / "commondir").write_text(str(foreign / ".git") + "\n")
        with self.assertRaises(target.InstanceError):
            target.validate_home(self.root)
        with self.assertRaises(target.InstanceError):
            target.prepare(self.root)

    def test_git_boundary_refuses_shared_objects_and_refs(self) -> None:
        for name in ("objects", "refs"):
            with self.subTest(name=name):
                local = self.workspace / ".git" / name
                foreign = self.root / ("foreign-" + name)
                local.rename(foreign)
                local.symlink_to(foreign, target_is_directory=True)
                with self.assertRaises(target.InstanceError):
                    target.validate_home(self.root)
                with self.assertRaises(target.InstanceError):
                    target.prepare(self.root)
                local.unlink()
                foreign.rename(local)

    def test_git_boundary_refuses_object_alternates(self) -> None:
        alternates = self.workspace / ".git" / "objects" / "info" / "alternates"
        alternates.parent.mkdir(exist_ok=True)
        alternates.write_text(str(self.root / "foreign-objects") + "\n")
        with self.assertRaises(target.InstanceError):
            target.validate_home(self.root)
        with self.assertRaises(target.InstanceError):
            target.prepare(self.root)

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
        self.assertEqual(env["GIT_ALLOW_PROTOCOL"], "file")
        self.assertTrue(sandbox.is_dir())
        self.assertTrue((sandbox / ".config").is_dir())
        self.assertTrue((sandbox / ".config" / "gh").is_dir())
        self.assertEqual(env["GIT_CEILING_DIRECTORIES"], str(self.workspace.parent))
        self.assertEqual(target.os.environ.get("HOME"), source_home)

    def test_start_refuses_a_live_instance_before_exec(self) -> None:
        target.private_json(self.userdata / "server-runtime.json", {"pid": target.os.getpid()})
        with patch.object(target, "REPOSITORY", self.root), \
             patch.object(target.sys, "argv", ["loom_test_instance.py", "start"]), \
             patch.object(target.sys, "stderr", io.StringIO()), \
             patch.object(target.os, "chdir"), patch.object(target.os, "execve") as execute:
            with self.assertRaises(SystemExit) as error:
                target.main()
            self.assertEqual(error.exception.code, 1)
            execute.assert_not_called()

    def test_empty_home_before_marker_publication_is_retryable(self) -> None:
        shutil.rmtree(self.home)
        self.home.mkdir()

        def seed(repository: Path, args: list[str]) -> str:
            self.workspace.mkdir(parents=True)
            target.private_json(self.userdata / "dev-fixture.json", {"version": 1, "scenario": "sample"})
            return ""
        with patch.object(target, "run_node", side_effect=seed):
            self.assertEqual(target.prepare(self.root), self.home)
        self.assertEqual(target.read_json(self.home / "vault-test-instance.json"), target.MARKER)

    def test_interrupted_marker_publication_leaves_home_retryable(self) -> None:
        shutil.rmtree(self.home)
        with patch.object(target.os, "replace", side_effect=OSError("synthetic interrupted publication")), \
             patch.object(target, "run_node"):
            with self.assertRaises(OSError):
                target.prepare(self.root)
        self.assertEqual(list(self.home.iterdir()), [])
        self.test_empty_home_before_marker_publication_is_retryable()

    def test_invalid_seed_markers_are_archived_and_reseeded(self) -> None:
        for payload in ("", "{", '{"version":1,"scenario":"other"}',
                        '{"version":2,"scenario":"sample"}', "null"):
            with self.subTest(payload=payload):
                (self.userdata / "dev-fixture.json").write_text(payload)
                (self.userdata / "statev2.sqlite").write_bytes(b"interrupted-seed-canary")

                def seed(repository: Path, args: list[str]) -> str:
                    target.private_json(self.userdata / "dev-fixture.json", {"version": 1, "scenario": "sample"})
                    (self.userdata / "statev2.sqlite").write_bytes(b"complete-synthetic-seed")
                    return ""
                with patch.object(target, "run_node", side_effect=seed) as run:
                    self.assertEqual(target.prepare(self.root), self.home)
                    run.assert_called_once()
        archives = list((self.home / "incomplete-seeds").glob("*/statev2.sqlite"))
        self.assertEqual(len(archives), 5)
        self.assertTrue(all(path.read_bytes() == b"interrupted-seed-canary" for path in archives))

    def test_private_write_failure_keeps_existing_json_intact(self) -> None:
        path = self.userdata / "settings.json"
        original = path.read_bytes()

        def interrupt(value, stream, **kwargs):
            stream.write('{"partial":')
            raise OSError("synthetic interrupted write")
        with patch.object(target.json, "dump", side_effect=interrupt):
            with self.assertRaises(OSError):
                target.private_json(path, {"replacement": True})
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(self.userdata.glob(".settings.json.*.tmp")), [])

    def test_unmarked_partial_settings_can_be_retried(self) -> None:
        (self.userdata / "dev-fixture.json").unlink()
        (self.userdata / "settings.json").write_text('{"providerInstances":')

        def seed(repository: Path, args: list[str]) -> str:
            self.assertEqual(target.read_json(self.userdata / "settings.json"), target.SETTINGS)
            target.private_json(self.userdata / "dev-fixture.json", {"version": 1, "scenario": "sample"})
            return ""
        with patch.object(target, "run_node", side_effect=seed):
            self.assertEqual(target.prepare(self.root), self.home)

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

    def test_proof_rejects_a_replacement_that_cannot_read(self) -> None:
        self.rejected_proof(lambda path, token, response, issued, revoked:
                            (401, None) if path.endswith("/shell") and token == "secret-canary-1"
                            and "s1" not in revoked else response)

    def rejected_issue(self, change) -> None:
        cli, http, sessions, _, _ = self.auth_fixture()

        def malformed(repository, args):
            result = cli(repository, args)
            if args[3] == "issue":
                value = json.loads(result)
                change(value)
                return json.dumps(value)
            return result
        with patch.object(target, "run_node", side_effect=malformed), patch.object(target, "request", side_effect=http):
            with self.assertRaisesRegex(target.InstanceError, "Unexpected test session"):
                target.prove(self.root)
        self.assertEqual(set(sessions), {"unrelated"})

    def test_proof_rejects_issue_with_write_scope(self) -> None:
        self.rejected_issue(lambda value: value.update(scopes=["orchestration:read", "orchestration:write"]))

    def test_proof_rejects_issue_with_foreign_subject(self) -> None:
        self.rejected_issue(lambda value: value.update(subject="another-invocation"))

    def test_proof_rejects_non_string_token(self) -> None:
        for token in (None, 123, ["synthetic"], {"synthetic": True}):
            with self.subTest(token=token):
                self.rejected_issue(lambda value: value.update(token=token))

    def test_proof_rejects_non_string_session_id(self) -> None:
        for session_id in (None, 123, ["synthetic"], {"synthetic": True}):
            with self.subTest(session_id=session_id):
                self.rejected_issue(lambda value: value.update(sessionId=session_id))

    def test_proof_rejects_reused_session_id(self) -> None:
        cli, http, sessions, issued, _ = self.auth_fixture()

        def reused(repository, args):
            result = cli(repository, args)
            if args[3] == "issue" and len(issued) == 2:
                value = json.loads(result)
                sessions.pop(str(value["sessionId"]))
                value["sessionId"] = issued[0]["sessionId"]
                sessions[str(value["sessionId"])] = value
                return json.dumps(value)
            return result
        with patch.object(target, "run_node", side_effect=reused), patch.object(target, "request", side_effect=http):
            with self.assertRaisesRegex(target.InstanceError, "Reset reused"):
                target.prove(self.root)
        self.assertEqual(set(sessions), {"unrelated"})

    def test_proof_rejects_silent_cleanup_failure_on_relist(self) -> None:
        cli, http, sessions, _, _ = self.auth_fixture()

        def no_op_revoke(repository, args):
            if args[3:5] == ["revoke", "s1"]:
                return "revoked"
            return cli(repository, args)

        replacement_reads = 0

        def expire_after_first_read(origin, path, token=None):
            nonlocal replacement_reads
            if path.endswith("/shell") and token == "secret-canary-1":
                replacement_reads += 1
                if replacement_reads > 1:
                    return 401, None
            return http(origin, path, token)
        with patch.object(target, "run_node", side_effect=no_op_revoke), \
             patch.object(target, "request", side_effect=expire_after_first_read):
            with self.assertRaisesRegex(target.InstanceError, "cleanup is incomplete"):
                target.prove(self.root)
        self.assertIn("s1", sessions)

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
