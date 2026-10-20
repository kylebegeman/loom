import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as ProcessRunner from "../../processRunner.ts";
import * as MigrationGitMetadata from "./MigrationGitMetadata.ts";

it("reports endpoint hints without URL authentication, helper bodies or local paths", () => {
  const result = MigrationGitMetadata.parseMigrationGitMetadata(
    [
      "remote.origin.url\nhttps://user:private-token@github.com/dev/repo.git?token=private-query",
      "remote.origin.pushurl\ngit@github.com:dev/fork.git",
      "remote.origin.pushurl\nssh://git@code.example:2222/team/repo.git",
      "remote.files.url\n/private/local/credential-folder",
      "remote.custom.url\next::helper private-material",
      "core.sshcommand\nssh -o Secret=private-ssh-command",
      "credential.https://github.com.helper\n!private-helper-body",
      "url.https://private-rewrite@host/.insteadof\nshortcut:",
      "",
    ].join("\0"),
  );
  expect(result.dependencies[0]).toMatchObject({
    hostname: "github.com",
    repository: "dev/repo",
    embeddedAuthentication: true,
  });
  expect(result.dependencies[1]).toMatchObject({
    direction: "push",
    position: 0,
    transport: "ssh",
    port: 22,
    gitPath: "dev/fork.git",
  });
  expect(result.dependencies[2]).toMatchObject({
    direction: "push",
    position: 1,
    hostname: "code.example",
    port: 2222,
    gitPath: "/team/repo.git",
  });
  expect(result.dependencies[3]).toMatchObject({
    transport: "other",
    hostname: null,
    repository: null,
  });
  expect(result).toMatchObject({
    localSshCommand: true,
    localCredentialHelper: true,
    localUrlRewrite: true,
  });
  const safe = JSON.stringify(result);
  for (const secret of [
    "private-token",
    "private-query",
    "private-material",
    "private-ssh-command",
    "private-helper-body",
    "private-rewrite",
    "credential-folder",
  ])
    expect(safe).not.toContain(secret);
});
it("does not mistake HTTP, file URLs or remote helpers for SCP-style SSH", () => {
  const result = MigrationGitMetadata.parseMigrationGitMetadata(
    ["http://github.com/dev/repo", "file:///tmp/repo", "ext::helper"]
      .map((url, i) => `remote.source${i}.url\n${url}\0`)
      .join(""),
  );
  expect(result.dependencies.map((d) => d.transport)).toEqual(["other", "other", "other"]);
});
it("preserves SSH absolute and relative paths and refuses ambiguous dot-segment paths", () => {
  const urls = [
    "git@code.example:team/repo.git",
    "git@code.example:/team/repo.git",
    "ssh://git@code.example/team/repo.git",
    "ssh://git@code.example/team/../repo.git",
  ];
  const result = MigrationGitMetadata.parseMigrationGitMetadata(
    urls.map((url, i) => `remote.source${i}.url\n${url}\0`).join(""),
  );
  expect(result.dependencies.map((d) => d.gitPath)).toEqual([
    "team/repo.git",
    "/team/repo.git",
    "/team/repo.git",
    null,
  ]);
});
it("never interprets a query or fragment containing slashes as a repository path", () => {
  const result = MigrationGitMetadata.parseMigrationGitMetadata(
    "remote.origin.url\nhttps://github.com?token=private-query/path-value\0remote.other.url\nhttps://github.com#private-fragment/path-value\0",
  );
  expect(result.dependencies.map((d) => d.repository)).toEqual([null, null]);
  expect(JSON.stringify(result)).not.toContain("private-query");
  expect(JSON.stringify(result)).not.toContain("private-fragment");
  expect(JSON.stringify(result)).not.toContain("path-value");
});
it("caps remote entries and counts unreported metadata rather than implying full coverage", () => {
  const raw =
    Array.from(
      { length: 42 },
      (_, i) => `remote.source${i}.url\ngit@github.com:dev/repo${i}.git\0`,
    ).join("") + "remote.invalid name.url\nhttps://example.com/a\0";
  const result = MigrationGitMetadata.parseMigrationGitMetadata(raw);
  expect(result.dependencies).toHaveLength(40);
  expect(result.omittedDependencies).toBe(3);
});
it.effect(
  "reads real local Git metadata without resolving includes, invoking helpers or changing configuration",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path,
        runner = yield* ProcessRunner.ProcessRunner,
        env = yield* HostProcess.Environment;
      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: "loom-migration-metadata-test-",
      });
      const globalConfig = path.join(directory, "global.gitconfig"),
        included = path.join(directory, "included.gitconfig"),
        marker = path.join(directory, "unexpected-helper");
      yield* fs.writeFileString(
        globalConfig,
        '[remote "global"]\nurl = https://github.com/private/global.git\n',
      );
      yield* fs.writeFileString(
        included,
        '[remote "included"]\nurl = https://github.com/private/included.git\n',
      );
      const run = (args: ReadonlyArray<string>) =>
        runner.run({
          command: "git",
          args,
          cwd: directory,
          extendEnv: false,
          env: {
            PATH: env.PATH ?? "/usr/bin:/bin",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
          },
        });
      expect((yield* run(["init", "--template="])).code).toBe(0);
      for (const [key, value] of [
        ["remote.origin.url", "https://dev:synthetic-secret@github.com/dev/repo.git"],
        ["include.path", included],
        ["credential.helper", `!touch ${marker}`],
        ["core.sshCommand", `touch ${marker}`],
      ])
        expect((yield* run(["config", "--local", key!, value!])).code).toBe(0);
      const before = yield* fs.readFileString(path.join(directory, ".git/config"));
      const result = yield* Effect.flatMap(MigrationGitMetadata.MigrationGitMetadata, (service) =>
        service.read(directory),
      ).pipe(
        Effect.provide(MigrationGitMetadata.layer),
        Effect.provideService(HostProcess.Environment, {
          PATH: env.PATH,
          GIT_CONFIG_GLOBAL: globalConfig,
          GIT_SSH_COMMAND: `touch ${marker}`,
          GITHUB_TOKEN: "synthetic-ambient-token",
        }),
      );
      expect(result.metadata.dependencies.map((d) => d.remote)).toEqual(["origin"]);
      expect(result.metadata.localSshCommand).toBe(true);
      expect(result.metadata.localCredentialHelper).toBe(true);
      expect(JSON.stringify(result.metadata)).not.toContain("synthetic-secret");
      expect(Redacted.value(result.raw)).toContain("remote.origin.url");
      expect(yield* fs.exists(marker)).toBe(false);
      expect(yield* fs.readFileString(path.join(directory, ".git/config"))).toBe(before);
    }).pipe(
      Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.scoped,
    ),
);
