import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderDriverKind, type ServerProvider } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Providers from "../../provider/ProviderRegistry.ts";
import * as Instances from "../../provider/ProviderInstanceRegistry.ts";
import * as Projects from "../../project/ProjectService.ts";
import * as Settings from "../../serverSettings.ts";
import * as Config from "../../config.ts";
import * as ProcessRunner from "../../processRunner.ts";
import * as Store from "./SkillStore.ts";
import * as Registry from "./SkillRegistryService.ts";
import { makeSkillFiles } from "./SkillFiles.ts";
import { SkillSourceTransport } from "./SkillSources.ts";

const base = Layer.merge(NodeServices.layer, NodeCrypto.layer);
const fixture = Effect.gen(function* () {
  const files = yield* makeSkillFiles;
  const root = yield* files.fs.makeTempDirectoryScoped();
  const home = files.path.join(root, "home");
  yield* files.fs.makeDirectory(home);
  const failRefresh = yield* Ref.make(false);
  const provider: ServerProvider = {
    instanceId: ProviderInstanceId.make("claude"),
    driver: ProviderDriverKind.make("claude"),
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "unknown" },
    checkedAt: "2026-10-28T00:00:00.000Z",
    version: null,
    models: [],
    slashCommands: [],
    skills: [],
  };
  const failSwap = yield* Ref.make(false);
  const failMetadata = yield* Ref.make(false);
  const fs = FileSystem.FileSystem.of({
    ...files.fs,
    rename: (from, to) =>
      Effect.gen(function* () {
        const failNext =
          from.endsWith(`${files.path.sep}next`) &&
          to.endsWith(`${files.path.sep}sample`) &&
          (yield* Ref.getAndSet(failSwap, false));
        const failState =
          to.endsWith(`${files.path.sep}registry.json`) &&
          (yield* Ref.getAndSet(failMetadata, false));
        if (failNext || failState)
          return yield* PlatformError.systemError({
            module: "FileSystem",
            method: "rename",
            _tag: "PermissionDenied",
            pathOrDescriptor: to,
          });
        return yield* files.fs.rename(from, to);
      }),
  });
  const config = Config.layerTest(root, files.path.join(root, "state"));
  const layer = Registry.layer.pipe(
    Layer.provide(Store.layer.pipe(Layer.provide(config))),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Providers.ProviderRegistry)({
          getProviders: Ref.get(failRefresh).pipe(Effect.map((fail) => (fail ? [provider] : []))),
          refreshInstance: () => Effect.die("Provider refresh unavailable"),
        }),
        Layer.mock(Instances.ProviderInstanceRegistry)({ listInstances: Effect.succeed([]) }),
        Layer.mock(Projects.ProjectService)({}),
        Settings.layerTest(),
        ProcessRunner.layer,
      ),
    ),
  );
  const context = yield* Layer.build(layer).pipe(
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(HostProcess.HomeDirectory, home),
    Effect.provideService(HostProcess.Environment, {}),
    Effect.provideService(SkillSourceTransport, {
      normalizeUrl: (value) => value,
      allowFile: true,
    }),
  );
  const service = yield* Registry.SkillRegistryService.pipe(Effect.provideContext(context));
  const target = (yield* service.inventory({ projectId: null })).targets.find(
    (value) => value.isDefault,
  )!;
  return { service, files, root, home, target, failSwap, failMetadata, failRefresh };
});

it.effect(
  "creates, edits and trashes a Lab skill while preserving conflicting external changes",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const created = yield* f.service.scaffold({
          projectId: null,
          targetId: f.target.id,
          name: "sample",
          description: "Use for a sample",
          body: "Original instructions",
          userInvocationOnly: true,
          hideFromSlashMenu: false,
        });
        expect(created.validation.issues).toEqual([]);
        expect(
          yield* f.files.fs.readFileString(f.files.path.join(created.key, "agents", "openai.yaml")),
        ).toContain("allow_implicit_invocation: false");
        yield* Ref.set(f.failRefresh, true);
        const edited = yield* f.service.writeSkill({
          projectId: null,
          key: created.key,
          expectedHash: created.hash,
          text: created.text.replace("Original", "New"),
        });
        expect(edited.text).toContain("New instructions");
        expect(
          yield* Effect.flip(
            f.service.writeSkill({
              projectId: null,
              key: created.key,
              expectedHash: created.hash,
              text: created.text,
            }),
          ),
        ).toMatchObject({ reason: "conflict" });
        const entry = (yield* f.service.inventory({ projectId: null, refresh: true })).entries.find(
          (value) => value.key === created.key,
        )!;
        const removed = yield* f.service.remove({
          projectId: null,
          key: created.key,
          expectedHash: entry.currentHash!,
        });
        expect(yield* f.files.fs.exists(created.key)).toBe(false);
        expect(
          yield* f.files.fs.readFileString(f.files.path.join(removed.trashPath, "SKILL.md")),
        ).toContain("New instructions");
        expect((yield* f.service.sources).installs).toEqual([]);
      }),
    ).pipe(Effect.provide(base)),
);

it.effect("rolls back a scaffold when its provenance cannot be committed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* Ref.set(f.failMetadata, true);
      const result = yield* Effect.flip(
        f.service.scaffold({
          projectId: null,
          targetId: f.target.id,
          name: "sample",
          description: "Use for a sample",
          body: "Instructions",
          userInvocationOnly: false,
          hideFromSlashMenu: false,
        }),
      );
      expect(result.reason).toBe("io");
      expect(yield* f.files.fs.exists(f.files.path.join(f.target.realPath, "sample"))).toBe(false);
      expect((yield* f.service.sources).installs).toEqual([]);
    }),
  ).pipe(Effect.provide(base)),
);

it.live(
  "reviews pinned updates, rejects stale or locally edited replacements and restores a failed swap",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        const runner = yield* ProcessRunner.ProcessRunner;
        const repo = f.files.path.join(f.root, "repository");
        const skill = f.files.path.join(repo, "skills", "sample");
        yield* f.files.fs.makeDirectory(skill, { recursive: true });
        const first = "---\nname: sample\ndescription: Use for a sample\n---\nOriginal body\n";
        yield* f.files.fs.writeFileString(f.files.path.join(skill, "SKILL.md"), first);
        yield* f.files.fs.writeFileString(f.files.path.join(repo, "LICENSE"), "Repository license");
        yield* f.files.fs.writeFileString(
          f.files.path.join(skill, "LICENSE.source"),
          "Bundled notice",
        );
        yield* f.files.fs.writeFile(
          f.files.path.join(skill, "image.bin"),
          new Uint8Array([0, 255, 128]),
        );
        const git = Effect.fn("SkillRegistryTest.git")((args: readonly string[]) =>
          runner.run({
            command: "git",
            args: [
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "commit.gpgSign=false",
              "-c",
              "user.name=Fixture",
              "-c",
              "user.email=fixture@example.test",
              ...args,
            ],
            cwd: repo,
          }),
        );
        yield* git(["init"]);
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "first"]);
        const fetch = Effect.fn("SkillRegistryTest.fetch")(function* (requestId: string) {
          yield* f.service.fetchSource({ requestId, url: `file://${repo}` });
          const result = Option.getOrThrow(
            yield* f.service.watchFetch(requestId).pipe(Stream.runLast),
          );
          expect(result.phase, result.error ?? "").toBe("ready");
          return result.source!;
        });
        const source = yield* fetch("first");
        const installed = (yield* f.service.install({
          projectId: null,
          sourceId: source.id,
          commit: source.commit,
          subpaths: ["skills/sample"],
          targetId: f.target.id,
        }))[0]!;
        expect(
          yield* f.files.fs.readFileString(
            f.files.path.join(installed.directory, "LICENSE.source"),
          ),
        ).toBe("Bundled notice");
        expect(
          yield* f.files.fs.readFileString(
            f.files.path.join(installed.directory, "LICENSE.source.1"),
          ),
        ).toBe("Repository license");
        yield* f.files.fs.writeFileString(
          f.files.path.join(skill, "SKILL.md"),
          first.replace("Original", "Updated"),
        );
        yield* f.files.fs.writeFile(
          f.files.path.join(skill, "image.bin"),
          new Uint8Array([0, 254, 128]),
        );
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "second"]);
        const latest = yield* fetch("second");
        const preview = yield* f.service.previewUpdate({
          projectId: null,
          installId: installed.id,
        });
        expect(preview).toMatchObject({
          fromCommit: source.commit,
          toCommit: latest.commit,
          modified: false,
        });
        expect(preview.files).toEqual([
          { path: "SKILL.md", change: "modified" },
          { path: "image.bin", change: "modified" },
        ]);
        expect(preview.diff).toContain("+Updated body");
        yield* Ref.set(f.failSwap, true);
        expect(
          yield* Effect.flip(
            f.service.update({
              projectId: null,
              installId: installed.id,
              reviewToken: preview.reviewToken,
              force: false,
            }),
          ),
        ).toMatchObject({ reason: "io" });
        expect(
          yield* f.files.fs.readFileString(f.files.path.join(installed.directory, "SKILL.md")),
        ).toBe(first);
        expect((yield* f.service.sources).installs[0]?.commit).toBe(source.commit);
        yield* f.files.fs.writeFileString(
          f.files.path.join(installed.directory, "SKILL.md"),
          first.replace("Original", "Local"),
        );
        expect(
          yield* Effect.flip(
            f.service.update({
              projectId: null,
              installId: installed.id,
              reviewToken: preview.reviewToken,
              force: true,
            }),
          ),
        ).toMatchObject({ reason: "conflict" });
        const revised = yield* f.service.previewUpdate({
          projectId: null,
          installId: installed.id,
        });
        expect(revised.modified).toBe(true);
        expect(
          yield* Effect.flip(
            f.service.update({
              projectId: null,
              installId: installed.id,
              reviewToken: revised.reviewToken,
              force: false,
            }),
          ),
        ).toMatchObject({ reason: "conflict" });
        const updated = yield* f.service.update({
          projectId: null,
          installId: installed.id,
          reviewToken: revised.reviewToken,
          force: true,
        });
        expect(updated.commit).toBe(latest.commit);
        expect(
          yield* f.files.fs.readFileString(f.files.path.join(installed.directory, "SKILL.md")),
        ).toContain("Updated body");
        expect(
          Array.from(
            yield* f.files.fs.readFile(f.files.path.join(installed.directory, "image.bin")),
          ),
        ).toEqual([0, 254, 128]);
        yield* f.files.fs.writeFileString(f.files.path.join(skill, "SKILL.md"), "Broken metadata");
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "invalid skill"]);
        yield* fetch("invalid");
        expect(
          yield* Effect.flip(f.service.previewUpdate({ projectId: null, installId: installed.id })),
        ).toMatchObject({ reason: "invalid" });
        expect(
          yield* f.files.fs.readFileString(f.files.path.join(installed.directory, "SKILL.md")),
        ).toContain("Updated body");
      }),
    ).pipe(Effect.provide(Layer.merge(base, ProcessRunner.layer.pipe(Layer.provide(base))))),
);
