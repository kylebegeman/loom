// @effect-diagnostics nodeBuiltinImport:off -- Disposable executable fixtures inspect child credential routing without network calls.
import * as NodeChildProcess from "node:child_process";
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
it.effect("repository hooks are disabled without blocking scoped release commands", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write(
      "git",
      `const cp=require('node:child_process');const result=cp.spawnSync('/usr/bin/git',process.argv.slice(2),{env:process.env,encoding:'utf8'});process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exit(result.status??1);`,
    );
    const repository = NodePath.join(f.dir, "repository");
    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(repository);
      await NodeFSP.mkdir(NodePath.join(repository, ".git"));
      await NodeFSP.mkdir(NodePath.join(repository, ".git", "objects"));
      await NodeFSP.mkdir(NodePath.join(repository, ".git", "refs"));
      await NodeFSP.writeFile(NodePath.join(repository, ".git", "HEAD"), "ref: refs/heads/main\n");
      await NodeFSP.writeFile(
        NodePath.join(repository, ".git", "config"),
        "[core]\nrepositoryformatversion = 0\nhooksPath = /repository-hooks\n",
      );
    });
    yield* f.write(
      "gh",
      `const cp=require('node:child_process');const hooks=cp.spawnSync('/usr/bin/git',['config','--get','core.hooksPath'],{env:process.env,encoding:'utf8'});console.log(JSON.stringify({hooks:hooks.stdout.trim(),args:process.argv.slice(2)}));process.exit(hooks.status??1);`,
    );
    const input = {
      token: Redacted.make("synthetic-terminal-token"),
      repository: "owner/repo",
      command: { tool: "gh" as const, argv: ["release", "view", "v1.2.3"] },
      cwd: repository,
      authorize: Effect.void,
    };
    const result = yield* f.service.execute(input);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      hooks: "/dev/null",
      args: ["release", "view", "v1.2.3", "--repo", "owner/repo"],
    });
    yield* Effect.promise(() =>
      NodeFSP.appendFile(
        NodePath.join(repository, ".git", "config"),
        '[url "https://elsewhere.invalid/"]\ninsteadOf = https://github.com/\n',
      ),
    );
    expect((yield* f.service.execute(input).pipe(Effect.flip)).reason).toBe("unsafe-git-config");
  }).pipe(Effect.scoped),
);
it.effect("a push to origin leaves origin's tracking branch, upstream and lease current", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const remote = NodePath.join(f.dir, "remote.git"),
      checkout = NodePath.join(f.dir, "checkout");
    // Real git, with only the network hop swapped: the selected GitHub URL resolves to a local
    // bare repository. The child's own configuration still chooses the remote and refs.
    yield* f.write(
      "git",
      `const cp=require('node:child_process');const env={...process.env};if(['push','fetch'].includes(process.argv[2])){const n=Number(env.GIT_CONFIG_COUNT??0);env.GIT_CONFIG_COUNT=String(n+2);env['GIT_CONFIG_KEY_'+n]=${JSON.stringify(`url.${remote}.insteadOf`)};env['GIT_CONFIG_VALUE_'+n]='https://github.com/owner/repo.git';env['GIT_CONFIG_KEY_'+(n+1)]='protocol.file.allow';env['GIT_CONFIG_VALUE_'+(n+1)]='always'}const r=cp.spawnSync('/usr/bin/git',process.argv.slice(2),{env,encoding:'utf8'});process.stdout.write(r.stdout??'');process.stderr.write(r.stderr??'');process.exit(r.status??1);`,
    );
    const git = (...args: string[]) =>
      NodeChildProcess.execFileSync("/usr/bin/git", args, {
        cwd: f.dir,
        encoding: "utf8",
        env: {
          PATH: "/usr/bin:/bin",
          HOME: f.dir,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "Loom",
          GIT_AUTHOR_EMAIL: "loom@example.test",
          GIT_COMMITTER_NAME: "Loom",
          GIT_COMMITTER_EMAIL: "loom@example.test",
        },
      }).trim();
    git("init", "-q", "--bare", remote);
    git("init", "-q", "-b", "main", checkout);
    git("-C", checkout, "remote", "add", "origin", "git@github.com:owner/repo.git");
    git("-C", checkout, "commit", "-q", "--allow-empty", "-m", "one");
    git("-C", checkout, "switch", "-q", "-c", "feature");
    git("-C", checkout, "commit", "-q", "--allow-empty", "-m", "two");
    const push = (...argv: string[]) =>
      f.service.execute({
        token: Redacted.make("synthetic-terminal-token"),
        repository: "owner/repo",
        command: { tool: "git", argv },
        cwd: checkout,
        authorize: Effect.void,
      });

    const pushed = yield* push("push", "-u", "origin", "feature");
    expect(pushed.exitCode).toBe(0);
    expect(pushed.stdout).toContain("set up to track 'origin/feature'");
    expect(git("-C", checkout, "rev-parse", "refs/remotes/origin/feature")).toBe(
      git("-C", checkout, "rev-parse", "feature"),
    );
    expect(git("-C", checkout, "config", "branch.feature.remote")).toBe("origin");
    expect(git("-C", checkout, "status", "-sb").split("\n")[0]).toBe("## feature...origin/feature");

    // A bare lease checks the remote against origin/feature, which the push above recorded.
    git("-C", checkout, "commit", "-q", "--amend", "--allow-empty", "-m", "three");
    expect((yield* push("push", "-q", "--force-with-lease", "origin", "feature")).exitCode).toBe(0);
    expect(git("--git-dir", remote, "rev-parse", "feature")).toBe(
      git("-C", checkout, "rev-parse", "feature"),
    );
    expect(git("-C", checkout, "status", "-sb").split("\n")[0]).toBe("## feature...origin/feature");

    // The checkout cannot add a destination to the remote that Loom's push uses.
    git("-C", checkout, "config", "remote.loom-vault-origin.pushurl", "https://elsewhere.invalid/x");
    expect((yield* push("push", "origin", "feature").pipe(Effect.flip)).reason).toBe(
      "unsafe-git-config",
    );
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

const releaseFixture = Effect.gen(function* () {
  const f = yield* fixture;
  yield* Effect.promise(() =>
    Promise.all([
      NodeFSP.mkdir(NodePath.join(f.dir, "checkout")),
      NodeFSP.mkdir(NodePath.join(f.dir, "outside")),
    ]),
  );
  const checkout = yield* Effect.promise(() => NodeFSP.realpath(NodePath.join(f.dir, "checkout")));
  const outside = yield* Effect.promise(() => NodeFSP.realpath(NodePath.join(f.dir, "outside")));
  const invoked = NodePath.join(f.dir, "gh-invoked");
  // Config inspection must run without either command credential in its environment.
  yield* f.write("git", `process.exit(process.env.GH_TOKEN||process.env.LOOM_GITHUB_TOKEN?91:0)`);
  yield* f.write(
    "gh",
    `require('node:fs').writeFileSync(${JSON.stringify(invoked)},'started');console.log(JSON.stringify({args:process.argv.slice(2),token:process.env.GH_TOKEN}));`,
  );
  const execute = (
    argv: string[],
    cwd: string | null = checkout,
    authorize: Effect.Effect<void, VaultGitHubError> = Effect.void,
  ) =>
    f.service.execute({
      token: Redacted.make("synthetic-terminal-token"),
      repository: "owner/repo",
      command: { tool: "gh", argv },
      cwd,
      authorize,
    });
  return { ...f, checkout, outside, invoked, execute };
});

it.effect("release assets and notes resolve inside the checkout and preserve asset labels", () =>
  Effect.gen(function* () {
    const f = yield* releaseFixture;
    const asset = NodePath.join(f.checkout, "artifact.tgz");
    const notes = NodePath.join(f.checkout, "notes#draft.md");
    yield* Effect.promise(async () => {
      await NodeFSP.writeFile(asset, "asset");
      await NodeFSP.writeFile(notes, "notes");
      await NodeFSP.symlink(asset, NodePath.join(f.checkout, "asset-link.tgz"));
    });
    const result = yield* f.execute([
      "release",
      "create",
      "v1.2.3",
      "asset-link.tgz#Binary #1",
      "--draft=false",
      "-p",
      "--title",
      "--notes-file",
      "-F",
      "notes#draft.md",
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      args: [
        "release",
        "create",
        "v1.2.3",
        `${asset}#Binary #1`,
        "--repo",
        "owner/repo",
        "--draft=false",
        "-p",
        "--title",
        "--notes-file",
        "--notes-file",
        notes,
        "--verify-tag",
      ],
      token: "[redacted]",
    });
    const textOnly = yield* f.execute(
      ["release", "edit", "v1.2.3", "--notes", "--notes-file"],
      null,
    );
    expect(JSON.parse(textOnly.stdout).args).toEqual([
      "release",
      "edit",
      "v1.2.3",
      "--repo",
      "owner/repo",
      "--notes",
      "--notes-file",
    ]);
    const upload = yield* f.execute(["release", "upload", "v1.2.3", "artifact.tgz"]);
    expect(JSON.parse(upload.stdout).args).toEqual([
      "release",
      "upload",
      "v1.2.3",
      asset,
      "--repo",
      "owner/repo",
    ]);
    const edit = yield* f.execute(["release", "edit", "v1.2.3", "--notes-file", "notes#draft.md"]);
    expect(JSON.parse(edit.stdout).args).toEqual([
      "release",
      "edit",
      "v1.2.3",
      "--repo",
      "owner/repo",
      "--notes-file",
      notes,
    ]);
  }).pipe(Effect.scoped),
);

it.effect(
  "release file inputs reject outside paths, escaping links, directories, globs and stdin",
  () =>
    Effect.gen(function* () {
      const f = yield* releaseFixture;
      yield* Effect.promise(async () => {
        await NodeFSP.writeFile(NodePath.join(f.outside, "artifact.tgz"), "outside");
        await NodeFSP.writeFile(NodePath.join(f.checkout, "artifact.tgz"), "inside");
        await NodeFSP.writeFile(NodePath.join(f.checkout, "literal*.tgz"), "literal glob");
        await NodeFSP.writeFile(NodePath.join(f.checkout, "literal#target.tgz"), "hash");
        await NodeFSP.symlink(
          NodePath.join(f.checkout, "literal#target.tgz"),
          NodePath.join(f.checkout, "hash-target.tgz"),
        );
        await NodeFSP.symlink(f.outside, NodePath.join(f.checkout, "escape"));
        await NodeFSP.symlink(
          NodePath.join(f.outside, "artifact.tgz"),
          NodePath.join(f.checkout, "escaped.tgz"),
        );
      });
      for (const filename of [
        NodePath.join(f.outside, "artifact.tgz"),
        "../outside/artifact.tgz",
        "escape/artifact.tgz",
        "escaped.tgz",
        ".",
        "literal*.tgz",
        "-",
        "missing.tgz",
      ]) {
        expect(
          (yield* f.execute(["release", "upload", "v1.2.3", filename]).pipe(Effect.flip)).reason,
        ).toBe("invalid-command");
        expect(
          (yield* f
            .execute(["release", "edit", "v1.2.3", "--notes-file", filename])
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-command");
      }
      expect(
        (yield* f.execute(["release", "upload", "v1.2.3", "hash-target.tgz"]).pipe(Effect.flip))
          .reason,
      ).toBe("invalid-command");
      expect(
        (yield* f
          .execute(["release", "upload", "v1.2.3", "artifact.tgz", "../outside/artifact.tgz"])
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-command");
      expect(
        (yield* f.execute(["release", "upload", "v1.2.3", "artifact.tgz"], null).pipe(Effect.flip))
          .reason,
      ).toBe("invalid-command");
      expect(
        (yield* f
          .execute(["release", "edit", "v1.2.3", "--notes-file", "artifact.tgz"], null)
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-command");
      expect(yield* Effect.promise(() => NodeFSP.readdir(f.dir))).not.toContain("gh-invoked");
    }).pipe(Effect.scoped),
);

it.effect("release download accepts an explicit existing empty directory within the checkout", () =>
  Effect.gen(function* () {
    const f = yield* releaseFixture;
    const destination = NodePath.join(f.checkout, "downloads");
    yield* Effect.promise(() => NodeFSP.mkdir(destination));
    const result = yield* f.execute([
      "release",
      "download",
      "v1.2.3",
      "--pattern",
      "--dir",
      "-D",
      "downloads",
    ]);
    expect(JSON.parse(result.stdout).args).toEqual([
      "release",
      "download",
      "v1.2.3",
      "--repo",
      "owner/repo",
      "--pattern",
      "--dir",
      "--dir",
      destination,
    ]);
  }).pipe(Effect.scoped),
);

it.effect("release download rejects missing, occupied, outside and escaping destinations", () =>
  Effect.gen(function* () {
    const f = yield* releaseFixture;
    yield* Effect.promise(async () => {
      await NodeFSP.mkdir(NodePath.join(f.checkout, "occupied"));
      await NodeFSP.writeFile(NodePath.join(f.checkout, "occupied", "existing.tgz"), "existing");
      await NodeFSP.mkdir(NodePath.join(f.checkout, "symlink-child"));
      await NodeFSP.symlink(f.outside, NodePath.join(f.checkout, "symlink-child", "asset.tgz"));
      await NodeFSP.symlink(f.outside, NodePath.join(f.checkout, "escape"));
      await NodeFSP.writeFile(NodePath.join(f.checkout, "file"), "file");
    });
    for (const destination of [
      "missing",
      "occupied",
      "symlink-child",
      "escape",
      "escape/.",
      "file",
      "../outside",
      f.outside,
      "-",
      "*",
    ]) {
      expect(
        (yield* f
          .execute(["release", "download", "v1.2.3", "--dir", destination])
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-command");
    }
    expect((yield* f.execute(["release", "download", "v1.2.3"]).pipe(Effect.flip)).reason).toBe(
      "invalid-command",
    );
    expect(
      (yield* f
        .execute(["release", "download", "v1.2.3", "--dir", f.outside], null)
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-command");
    expect(yield* Effect.promise(() => NodeFSP.readdir(f.dir))).not.toContain("gh-invoked");
    expect(yield* Effect.promise(() => NodeFSP.readdir(f.outside))).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect("validates every duplicate notes-file and download-dir occurrence", () =>
  Effect.gen(function* () {
    const f = yield* releaseFixture;
    yield* Effect.promise(async () => {
      await NodeFSP.writeFile(NodePath.join(f.checkout, "notes.md"), "inside");
      await NodeFSP.writeFile(NodePath.join(f.outside, "notes.md"), "outside");
      await NodeFSP.mkdir(NodePath.join(f.checkout, "downloads"));
    });
    for (const filenames of [
      ["notes.md", "../outside/notes.md"],
      ["../outside/notes.md", "notes.md"],
    ]) {
      expect(
        (yield* f
          .execute([
            "release",
            "edit",
            "v1.2.3",
            "--notes-file",
            filenames[0]!,
            "-F",
            filenames[1]!,
          ])
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-command");
    }
    expect(
      (yield* f
        .execute([
          "release",
          "create",
          "v1.2.3",
          "notes.md",
          "--notes-from-tag",
          "-F",
          "../outside/notes.md",
        ])
        .pipe(Effect.flip)).reason,
    ).toBe("invalid-command");
    for (const destinations of [
      ["downloads", "../outside"],
      ["../outside", "downloads"],
    ]) {
      expect(
        (yield* f
          .execute([
            "release",
            "download",
            "v1.2.3",
            "--dir",
            destinations[0]!,
            "-D",
            destinations[1]!,
          ])
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-command");
    }
    expect(yield* Effect.promise(() => NodeFSP.readdir(f.dir))).not.toContain("gh-invoked");
  }).pipe(Effect.scoped),
);

it.effect(
  "release file validation precedes authorization and denied authorization prevents gh",
  () =>
    Effect.gen(function* () {
      const f = yield* releaseFixture;
      yield* Effect.promise(() =>
        NodeFSP.writeFile(NodePath.join(f.checkout, "artifact.tgz"), "asset"),
      );
      let authorizations = 0;
      const denied = Effect.sync(() => {
        authorizations++;
      }).pipe(Effect.andThen(Effect.fail(new VaultGitHubError({ reason: "unauthorized" }))));
      expect(
        (yield* f
          .execute(["release", "upload", "v1.2.3", "../outside/missing.tgz"], f.checkout, denied)
          .pipe(Effect.flip)).reason,
      ).toBe("invalid-command");
      expect(authorizations).toBe(0);
      expect(
        (yield* f
          .execute(["release", "upload", "v1.2.3", "artifact.tgz"], f.checkout, denied)
          .pipe(Effect.flip)).reason,
      ).toBe("unauthorized");
      expect(authorizations).toBe(1);
      expect(yield* Effect.promise(() => NodeFSP.readdir(f.dir))).not.toContain("gh-invoked");
    }).pipe(Effect.scoped),
);
