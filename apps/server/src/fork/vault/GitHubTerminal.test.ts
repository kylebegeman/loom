// @effect-diagnostics nodeBuiltinImport:off -- Disposable executable fixtures inspect child credential routing without network calls.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { VaultGitHubError } from "@t3tools/contracts/fork";
import * as Terminal from "./GitHubTerminal.ts";
const fixture = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-github-terminal-test-")),
    ),
    (p) => Effect.promise(() => NodeFSP.rm(p, { recursive: true, force: true })),
  );
  const write = (name: string, code: string) =>
    Effect.promise(() =>
      NodeFSP.writeFile(NodePath.join(dir, name), `#!${NodeProcess.execPath}\n${code}`, {
        mode: 0o700,
      }),
    );
  const service = yield* Terminal.GitHubTerminal.pipe(
    Effect.provide(Terminal.layer),
    Effect.provideService(HostProcess.Environment, {
      PATH: dir + ":/usr/bin:/bin",
      HOME: "/personal",
      GITHUB_TOKEN: "personal-token",
      SSH_AUTH_SOCK: "personal-agent",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "personal-helper",
    }),
  );
  return { dir, write, service };
});
it.effect(
  "gh argv uses the selected identity, scrubs both streams and removes private configuration",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.write(
        "gh",
        `console.log(JSON.stringify({home:process.env.HOME,config:process.env.GH_CONFIG_DIR,token:process.env.GH_TOKEN,personal:process.env.GITHUB_TOKEN??null,ssh:process.env.SSH_AUTH_SOCK??null,args:process.argv.slice(2)}));console.error(process.env.GH_TOKEN)`,
      );
      const result = yield* f.service.execute({
        token: Redacted.make("synthetic-terminal-token"),
        repository: "owner/repo",
        command: { tool: "gh", argv: ["pr", "list"] },
        cwd: null,
        authorize: Effect.void,
      });
      const value = JSON.parse(result.stdout);
      expect(value).toMatchObject({
        token: "[redacted]",
        personal: null,
        ssh: null,
        args: ["pr", "list", "--repo", "owner/repo"],
      });
      expect(value.home).toBe(value.config);
      expect(result.stderr.trim()).toBe("[redacted]");
      expect(
        yield* Effect.promise(() =>
          NodeFSP.stat(value.home).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false);
    }).pipe(Effect.scoped),
);
it.effect("Git HTTPS helper supplies only the exact repository and bypasses personal helpers", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write(
      "git",
      `const cp=require('node:child_process');if(process.argv[2]==='config')process.exit(0);const fill=path=>cp.spawnSync('/usr/bin/git',['credential','fill'],{env:process.env,input:'protocol=https\\nhost=github.com\\npath='+path+'\\n\\n',encoding:'utf8'});const good=fill('owner/repo.git'),bad=fill('other/repo.git');console.log(JSON.stringify({home:process.env.HOME,token:process.env.GH_TOKEN??null,ssh:process.env.SSH_AUTH_SOCK??null,global:process.env.GIT_CONFIG_GLOBAL,good:good.stdout,bad:bad.stdout,badCode:bad.status,url:process.env.GIT_CONFIG_VALUE_10,args:process.argv.slice(2)}));`,
    );
    const result = yield* f.service.execute({
      token: Redacted.make("synthetic-terminal-token"),
      repository: "owner/repo",
      command: { tool: "git", argv: ["fetch", "origin"] },
      cwd: f.dir,
      authorize: Effect.void,
    });
    const value = JSON.parse(result.stdout);
    expect(value).toMatchObject({
      token: null,
      ssh: null,
      global: "/dev/null",
      args: ["fetch", "https://github.com/owner/repo.git", "+refs/heads/*:refs/remotes/origin/*"],
    });
    expect(value.good).toContain("password=[redacted]");
    expect(value.bad).not.toContain("password=");
    expect(value.badCode).not.toBe(0);
    expect(
      yield* Effect.promise(() =>
        NodeFSP.stat(value.home).then(
          () => true,
          () => false,
        ),
      ),
    ).toBe(false);
  }).pipe(Effect.scoped),
);
it.effect("rejects repository credential rewrites, denied execution and oversized output", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write(
      "git",
      `if(process.argv[2]==='config'){console.log('url.evil.insteadof');process.exit(0)}process.exit(88)`,
    );
    const input = {
      token: Redacted.make("synthetic-terminal-token"),
      repository: "owner/repo",
      command: { tool: "git" as const, argv: ["fetch", "origin"] },
      cwd: f.dir,
      authorize: Effect.void,
    };
    expect((yield* f.service.execute(input).pipe(Effect.flip)).reason).toBe("unsafe-git-config");
    yield* f.write("gh", `process.stdout.write('a'.repeat(70000));`);
    expect(
      (yield* f.service
        .execute({
          ...input,
          command: { tool: "gh", argv: ["pr", "list"] },
          cwd: null,
          authorize: Effect.fail(new VaultGitHubError({ reason: "unauthorized" })),
        })
        .pipe(Effect.flip)).reason,
    ).toBe("unauthorized");
    expect(
      (yield* f.service
        .execute({ ...input, command: { tool: "gh", argv: ["pr", "list"] }, cwd: null })
        .pipe(Effect.flip)).reason,
    ).toBe("failed");
  }).pipe(Effect.scoped),
);
