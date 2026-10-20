// @effect-diagnostics nodeBuiltinImport:off -- Test fixture creates a disposable fake gh executable and inspects its scoped child environment.
import * as NodeOS from "node:os";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Cli from "./GitHubCli.ts";
import { VaultGitHubError } from "@t3tools/contracts/fork";
it.effect(
  "isolates GH identity/config from personal credentials, scrubs output and cleans up",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-gh-test-"))),
        (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
      );
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(dir, "gh"),
          '#!/bin/sh\nprintf \'%s\\n\' "$HOME" "$GH_CONFIG_DIR" "$GH_HOST" "${GH_TOKEN:+present}" "${GITHUB_TOKEN:-empty}" "${SSH_AUTH_SOCK:-empty}" "$GH_TOKEN"\n',
          { mode: 0o700 },
        ),
      );
      const service = yield* Cli.GitHubCli.pipe(
        Effect.provide(Cli.layer),
        Effect.provideService(HostProcess.Environment, {
          PATH: dir + ":/usr/bin:/bin",
          GITHUB_TOKEN: "personal-should-not-be-used",
          SSH_AUTH_SOCK: "personal-agent",
        }),
      );
      const result = yield* service.run({
        token: Redacted.make("synthetic-scoped-token"),
        repository: "owner/repo",
        operation: { action: "repo-view" },
        authorize: Effect.void,
      });
      const [home, config, host, token, ambient, ssh, raw] = result.stdout.trim().split("\n");
      expect(home).toBe(config);
      expect(home).not.toBe(dir);
      expect(host).toBe("github.com");
      expect(token).toBe("present");
      expect(ambient).toBe("empty");
      expect(ssh).toBe("empty");
      expect(raw).toBe("[redacted]");
      expect(
        yield* Effect.promise(() =>
          NodeFSP.stat(home!).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false);
      expect(
        (yield* service
          .run({
            token: Redacted.make("synthetic-scoped-token"),
            repository: "owner/repo",
            operation: { action: "pr-list" },
            authorize: Effect.fail(new VaultGitHubError({ reason: "unauthorized" })),
          })
          .pipe(Effect.flip)).reason,
      ).toBe("unauthorized");
    }).pipe(Effect.scoped),
);
it.effect("bounds CLI output and reports missing CLI without leaking stderr", () =>
  Effect.gen(function* () {
    const missing = yield* Cli.GitHubCli.pipe(
      Effect.provide(Cli.layer),
      Effect.provideService(HostProcess.Environment, { PATH: "/does-not-exist" }),
    );
    const input = {
      token: Redacted.make("synthetic-scoped-token"),
      repository: "owner/repo",
      operation: { action: "pr-list" as const },
      authorize: Effect.void,
    };
    expect((yield* missing.run(input).pipe(Effect.flip)).reason).toBe("cli-unavailable");
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-gh-limit-"))),
      (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
    );
    yield* Effect.promise(() =>
      NodeFSP.writeFile(NodePath.join(dir, "gh"), "#!/bin/sh\nhead -c 20000 /dev/zero\n", {
        mode: 0o700,
      }),
    );
    const bounded = yield* Cli.GitHubCli.pipe(
      Effect.provide(Cli.layer),
      Effect.provideService(HostProcess.Environment, { PATH: dir + ":/usr/bin:/bin" }),
    );
    expect((yield* bounded.run(input).pipe(Effect.flip)).reason).toBe("failed");
  }).pipe(Effect.scoped),
);
