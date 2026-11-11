// @effect-diagnostics nodeBuiltinImport:off -- Disposable executables inspect credential routing without contacting a remote.
import * as NodeProcess from "node:process";
import { it, expect } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Transport from "./GitHubRepositoryTransport.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const service = yield* Transport.GitHubRepositoryTransport.pipe(
    Effect.provide(Transport.layer),
    Effect.provideService(HostProcess.Environment, {
      PATH: `${root}:/usr/bin:/bin`,
      HOME: "/personal",
      SSH_AUTH_SOCK: "/personal-agent",
      GITHUB_TOKEN: "personal-token",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "personal-helper",
    }),
  );
  const write = (code: string) =>
    fs.writeFileString(path.join(root, "git"), `#!${NodeProcess.execPath}\n${code}`, {
      mode: 0o700,
    });
  return { fs, path, root, service, write };
});
const token = Redacted.make("synthetic-repository-token");
it.live(
  "scopes clone credentials to one repository, scrubs streams, and removes helper files",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.write(
        `const cp=require('node:child_process');const fill=path=>cp.spawnSync('/usr/bin/git',['credential','fill'],{env:process.env,input:'protocol=https\\nhost=github.com\\npath='+path+'\\n\\n',encoding:'utf8'});const good=fill('owner/repo.git'),bad=fill('other/repo.git');console.log(JSON.stringify({home:process.env.HOME,args:process.argv.slice(2),cwd:process.cwd(),personal:process.env.GITHUB_TOKEN??null,ssh:process.env.SSH_AUTH_SOCK??null,good:good.stdout,bad:bad.stdout,badCode:bad.status,config:Object.fromEntries(Array.from({length:Number(process.env.GIT_CONFIG_COUNT)},(_,i)=>[process.env['GIT_CONFIG_KEY_'+i],process.env['GIT_CONFIG_VALUE_'+i]]))}));process.stderr.write('Receiving objects: 100% (1/1), done.\\n'+process.env.LOOM_GITHUB_TOKEN+'\\n');`,
      );
      const lines: string[] = [];
      const target = f.path.join(f.root, "arbitrary", "nested-copy");
      const result = yield* f.service.execute({
        repository: "owner/repo",
        token,
        operation: {
          kind: "clone",
          path: target,
          branch: "feature/library",
          onLine: (line) => Effect.sync(() => lines.push(line)),
        },
        authorize: Effect.void,
      });
      expect(result.code).toBe(0);
      const value = JSON.parse(result.stdout);
      expect(value.args).toEqual([
        "-c",
        "clone.defaultRemoteName=origin",
        "clone",
        "--progress",
        "--branch",
        "feature/library",
        "--",
        "https://github.com/owner/repo.git",
        target,
      ]);
      expect(value).toMatchObject({
        personal: null,
        ssh: null,
        good: expect.stringContaining("password=[redacted]"),
        badCode: 128,
        config: {
          "credential.useHttpPath": "true",
          "core.hooksPath": "/dev/null",
          "http.followRedirects": "false",
          "protocol.allow": "never",
        },
      });
      expect(value.bad).not.toContain("password=");
      expect(value.cwd).toBe(value.home);
      expect(yield* f.fs.exists(value.home)).toBe(false);
      expect(result.stderr).not.toContain(Redacted.value(token));
      expect(lines.join("\n")).not.toContain(Redacted.value(token));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.live("does not start Git after human authorization is revoked", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const marker = f.path.join(f.root, "started");
    yield* f.write(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');`);
    const failure = yield* f.service
      .execute({
        repository: "owner/repo",
        token,
        operation: { kind: "preflight" },
        authorize: Effect.fail(new VaultError({ reason: "denied" })),
      })
      .pipe(Effect.flip);
    expect(failure.reason).toBe("denied");
    expect(yield* f.fs.exists(marker)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.live("redacts credentials cut by output limits and drops oversized progress lines", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write(
      `process.stdout.write('x'.repeat(65530)+process.env.LOOM_GITHUB_TOKEN);process.stderr.write('a'.repeat(70000)+process.env.LOOM_GITHUB_TOKEN+'b'.repeat(65530));`,
    );
    const lines: string[] = [];
    const result = yield* f.service.execute({
      repository: "owner/repo",
      token,
      operation: {
        kind: "clone",
        path: f.path.join(f.root, "bounded-output"),
        branch: null,
        onLine: (line) => Effect.sync(() => lines.push(line)),
      },
      authorize: Effect.void,
    });
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.stdout.endsWith("[redacted]")).toBe(true);
    expect(result.stderr.startsWith("[redacted]")).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(65546);
    expect(result.stderr.length).toBeLessThanOrEqual(65546);
    expect(lines).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.live("cancellation stops the scoped child and cleans new and reserved clone destinations", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.write(
      `const fs=require('node:fs');fs.mkdirSync(process.argv.at(-1),{recursive:true});fs.writeFileSync(process.argv.at(-1)+'/partial','partial');console.error(JSON.stringify({home:process.env.HOME,pid:process.pid}));setInterval(()=>{},1000);`,
    );
    for (const existed of [false, true]) {
      const target = f.path.join(f.root, existed ? "reserved-copy" : "new-copy");
      if (existed) yield* f.fs.makeDirectory(target);
      const started = yield* Deferred.make<{ home: string; pid: number }>();
      const running = yield* f.service
        .execute({
          repository: "owner/repo",
          token,
          operation: {
            kind: "clone",
            path: target,
            branch: null,
            onLine: (line) => Deferred.succeed(started, JSON.parse(line)).pipe(Effect.asVoid),
          },
          authorize: Effect.void,
        })
        .pipe(Effect.forkChild({ startImmediately: true }));
      const child = yield* Deferred.await(started);
      yield* Fiber.interrupt(running);
      expect(yield* f.fs.exists(child.home)).toBe(false);
      expect(yield* f.fs.exists(target)).toBe(existed);
      if (existed) expect(yield* f.fs.readDirectory(target)).toEqual([]);
      expect(() => NodeProcess.kill(child.pid, 0)).toThrow();
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
