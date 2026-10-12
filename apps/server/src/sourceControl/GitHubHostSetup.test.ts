import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import * as Setup from "./GitHubHostSetup.ts";
import * as ProcessRunner from "../processRunner.ts";

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped();
  const bin = path.join(home, "bin");
  yield* fs.makeDirectory(bin);
  const gh = path.join(bin, "gh");
  yield* fs.writeFileString(
    gh,
    `#!/bin/sh
printf '%s\\n' "$*" >> "${home}/calls"
case "$*" in
  '--version') echo 'gh version 2.102.0';;
  'auth status --hostname github.com --active')
    if test -f "${home}/network-failure"; then echo 'failed to connect to api.github.com' >&2; exit 1; fi
    test -f "${home}/signed-in";;
  'auth login --hostname github.com --git-protocol https --web') touch "${home}/signed-in";;
  'auth setup-git --hostname github.com') test ! -f "${home}/helper-failure";;
  *) exit 1;;
esac
`,
  );
  yield* fs.chmod(gh, 0o755);
  const service = yield* Setup.make().pipe(
    Effect.provideService(HostProcess.HomeDirectory, home),
    Effect.provideService(HostProcess.Environment, { PATH: `${bin}:/usr/bin:/bin` }),
    Effect.provide(Layer.merge(FetchHttpClient.layer, ProcessRunner.layer)),
  );
  return { fs, home, gh, service, calls: () => fs.readFileString(path.join(home, "calls")) };
});

it.layer(NodeServices.layer)("GitHub host setup", (it) => {
  it.effect("reuses machine sign-in and configures Git without asking to sign in again", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(`${f.home}/signed-in`, "");
      yield* f.service.setup({ interactive: false });
      yield* f.service.setup({ interactive: false });
      const calls = yield* f.calls();
      assert.notInclude(calls, "auth login");
      assert.include(calls, "auth setup-git --hostname github.com");
    }),
  );
  it.effect("requires explicit interactive sign-in before touching Git configuration", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const error = yield* f.service.setup({ interactive: false }).pipe(Effect.flip);
      assert.equal(error.reason, "sign-in-required");
      const calls = yield* f.calls();
      assert.notInclude(calls, "auth login");
      assert.notInclude(calls, "auth setup-git");
    }),
  );
  it.effect("uses device sign-in once and verifies authentication before configuring Git", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.service.setup({ interactive: true });
      const calls = yield* f.calls();
      assert.include(calls, "auth login --hostname github.com --git-protocol https --web");
      assert.isTrue(calls.indexOf("auth login") < calls.indexOf("auth setup-git"));
      assert.equal((yield* f.service.status()).state, "signed-in");
    }),
  );
  it.effect(
    "does not request a new sign-in when the authentication probe cannot reach GitHub",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.fs.writeFileString(`${f.home}/signed-in`, "");
        yield* f.fs.writeFileString(`${f.home}/network-failure`, "");
        const error = yield* f.service.setup({ interactive: true }).pipe(Effect.flip);
        assert.equal(error.reason, "unavailable");
        assert.notInclude(yield* f.calls(), "auth login");
      }),
  );
  it.effect("reports helper configuration failure instead of claiming Git is ready", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.writeFileString(`${f.home}/signed-in`, "");
      yield* f.fs.writeFileString(`${f.home}/helper-failure`, "");
      assert.equal(
        (yield* f.service.setup({ interactive: false }).pipe(Effect.flip)).reason,
        "git-setup-failed",
      );
    }),
  );
  it.effect("rejects invalid repository URLs before sign-in or credential configuration", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const error = yield* f.service
        .setup({ interactive: true, repository: "https://token@github.com/owner/repo" })
        .pipe(Effect.flip);
      assert.equal(error.reason, "repository-invalid");
      assert.isFalse(yield* f.fs.exists(`${f.home}/calls`));
    }),
  );
  it.effect("rejects an unverified download without activating a CLI", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped();
      const service = yield* Setup.make().pipe(
        Effect.provideService(HostProcess.HomeDirectory, home),
        Effect.provideService(HostProcess.Environment, { PATH: `${home}/empty` }),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                new Response("unverified bytes", { status: 200 }),
              ),
            ),
          ),
        ),
        Effect.provide(ProcessRunner.layer),
      );
      const error = yield* service.setup({ interactive: false }).pipe(Effect.flip);
      assert.equal(error.reason, "installation-failed");
      assert.isFalse(yield* fs.exists(`${home}/.local/share/loom/tools/github-cli/bin/gh`));
    }),
  );
  it.effect("finds the user-local GitHub CLI even when the service PATH does not contain it", () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.fs.makeDirectory(`${f.home}/.local/bin`, { recursive: true });
      yield* f.fs.rename(f.gh, `${f.home}/.local/bin/gh`);
      const executable = yield* Setup.findExecutable({ PATH: `${f.home}/empty` }).pipe(
        Effect.provideService(HostProcess.HomeDirectory, f.home),
      );
      assert.equal(executable, `${f.home}/.local/bin/gh`);
    }),
  );
});
