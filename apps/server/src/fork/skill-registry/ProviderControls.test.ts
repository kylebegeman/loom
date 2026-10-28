import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import type { SkillRegistryEntry } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as Settings from "../../serverSettings.ts";
import { discoverClaudeSkills } from "../../provider/Drivers/ClaudeSkills.ts";
import { makeSkillFiles } from "./SkillFiles.ts";
import { makeProviderControls } from "./ProviderControls.ts";

const layer = Layer.merge(NodeServices.layer, NodeCrypto.layer);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const firstId = ProviderInstanceId.make("claude");
const secondId = ProviderInstanceId.make("claude_second");
const fixture = Effect.gen(function* () {
  const files = yield* makeSkillFiles;
  const root = yield* files.fs.makeTempDirectoryScoped();
  const homes = [files.path.join(root, "first"), files.path.join(root, "second")];
  const project = files.path.join(root, "project");
  const nested = files.path.join(project, "nested");
  const programData = files.path.join(root, "program-data");
  const environment = { PROGRAMDATA: programData };
  const entry: SkillRegistryEntry = {
    key: files.path.join(homes[0]!, "skills", "sample"),
    name: "sample",
    description: "Sample",
    locations: [],
    visibility: [firstId, secondId].map((instanceId) => ({
      instanceId,
      driver: ProviderDriverKind.make("claude"),
      scope: "user",
      enabled: true,
      userInvocationOnly: false,
      userInvocable: true,
      toggle: "claude",
    })),
    install: null,
    editable: true,
    containsScripts: false,
    currentHash: null,
    modified: false,
    problems: [],
  };
  for (const home of homes) {
    yield* files.fs.makeDirectory(files.path.join(home, "skills", "sample"), { recursive: true });
    yield* files.fs.writeFileString(
      files.path.join(home, "skills", "sample", "SKILL.md"),
      "---\nname: sample\ndescription: Use for a sample\n---\nInstructions",
    );
    yield* files.fs.writeFileString(
      files.path.join(home, "settings.json"),
      '{"theme":"dark","skillOverrides":{"other":"user-invocable-only"}}',
    );
  }
  yield* files.fs.makeDirectory(files.path.join(project, ".git"), { recursive: true });
  yield* files.fs.makeDirectory(nested);
  const providers: ServerProvider[] = [firstId, secondId].map((instanceId) => ({
    instanceId,
    driver: ProviderDriverKind.make("claude"),
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "unknown" },
    checkedAt: "2026-10-28T00:00:00.000Z",
    version: null,
    models: [],
    skills: [],
    slashCommands: [],
  }));
  const controls = yield* makeProviderControls.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed(providers) }),
        Settings.layerTest({
          providerInstances: {
            [firstId]: {
              driver: ProviderDriverKind.make("claude"),
              config: { homePath: homes[0] },
            },
            [secondId]: {
              driver: ProviderDriverKind.make("claude"),
              config: { homePath: homes[1] },
            },
          },
        }),
      ),
    ),
    Effect.provideService(HostProcess.Platform, "win32"),
    Effect.provideService(HostProcess.Environment, environment),
  );
  return { controls, files, entry, homes, project, nested, programData, environment };
});

it.effect(
  "writes native account overrides and preserves unrelated settings for every Claude account",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* fixture;
        yield* f.controls(
          {
            projectId: null,
            key: f.entry.key,
            instanceId: firstId,
            enabled: false,
            scope: "allAccounts",
          },
          f.entry,
          null,
        );
        for (const home of f.homes) {
          const settings = yield* f.files.fs
            .readFileString(f.files.path.join(home, "settings.json"))
            .pipe(Effect.flatMap(decodeJson));
          expect(settings).toMatchObject({
            theme: "dark",
            skillOverrides: { other: "user-invocable-only", sample: "off" },
          });
          const reported = yield* discoverClaudeSkills(
            { homePath: home },
            undefined,
            f.environment,
          );
          expect(reported.find((skill) => skill.name === "sample")?.enabled).toBe(false);
        }
      }),
    ).pipe(Effect.provide(layer)),
);

it.effect("uses repository-root project precedence and refuses a managed policy override", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.controls(
        {
          projectId: null,
          key: f.entry.key,
          instanceId: firstId,
          enabled: false,
          scope: "project",
        },
        f.entry,
        f.nested,
      );
      const file = f.files.path.join(f.project, ".claude", "settings.local.json");
      expect(yield* f.files.fs.readFileString(file).pipe(Effect.flatMap(decodeJson))).toMatchObject(
        { skillOverrides: { sample: "off" } },
      );
      const managed = f.files.path.join(f.programData, "ClaudeCode", "managed-settings.json");
      yield* f.files.fs.makeDirectory(f.files.path.dirname(managed), { recursive: true });
      yield* f.files.fs.writeFileString(managed, '{"skillOverrides":{"sample":"on"}}');
      expect(
        yield* Effect.flip(
          f.controls(
            {
              projectId: null,
              key: f.entry.key,
              instanceId: firstId,
              enabled: false,
              scope: "project",
            },
            f.entry,
            f.nested,
          ),
        ),
      ).toMatchObject({ reason: "read-only" });
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("validates every account before changing any file and preserves commented JSON", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const f = yield* fixture;
      const firstFile = f.files.path.join(f.homes[0]!, "settings.json");
      const otherFile = f.files.path.join(f.homes[1]!, "settings.json");
      const commented = '{\n // Keep this note\n "theme": "light"\n}';
      yield* f.files.fs.writeFileString(otherFile, commented);
      expect(
        yield* Effect.flip(
          f.controls(
            {
              projectId: null,
              key: f.entry.key,
              instanceId: firstId,
              enabled: false,
              scope: "allAccounts",
            },
            f.entry,
            null,
          ),
        ),
      ).toMatchObject({ reason: "invalid" });
      expect(yield* f.files.fs.readFileString(firstFile)).not.toContain('"sample"');
      expect(yield* f.files.fs.readFileString(otherFile)).toBe(commented);
    }),
  ).pipe(Effect.provide(layer)),
);
