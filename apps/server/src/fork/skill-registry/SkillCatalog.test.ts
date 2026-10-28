import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ProviderInstances from "../../provider/ProviderInstanceRegistry.ts";
import * as Projects from "../../project/ProjectService.ts";
import * as Settings from "../../serverSettings.ts";
import { makeSkillFiles } from "./SkillFiles.ts";
import { makeSkillCatalog } from "./SkillCatalog.ts";

const base = Layer.merge(NodeServices.layer, NodeCrypto.layer);
const provider = (id: string, skillPath: string): ServerProvider => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make("claude"),
  enabled: true,
  installed: true,
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "2026-10-28T00:00:00.000Z",
  version: null,
  models: [],
  slashCommands: [],
  skills: [
    {
      name: "sample",
      description: "Native description",
      path: skillPath,
      enabled: true,
      scope: "user",
    },
  ],
});

it.effect("merges accounts sharing a symlinked folder and keeps provider state authoritative", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* makeSkillFiles;
      const home = yield* files.fs.makeTempDirectoryScoped();
      const shared = files.path.join(home, ".claude", "skills");
      const otherHome = files.path.join(home, ".claude_second");
      const directory = files.path.join(shared, "sample");
      yield* files.fs.makeDirectory(directory, { recursive: true });
      yield* files.fs.makeDirectory(otherHome);
      yield* files.fs.symlink(shared, files.path.join(otherHome, "skills"));
      yield* files.fs.writeFileString(
        files.path.join(directory, "SKILL.md"),
        "---\nname: sample\ndescription: File description\n---\nInstructions",
      );
      const first = provider("claude", files.path.join(directory, "SKILL.md"));
      const second = {
        ...provider("claude_second", files.path.join(otherHome, "skills", "sample", "SKILL.md")),
        skills: [{ ...first.skills[0]!, enabled: false }],
      };
      const catalog = yield* makeSkillCatalog.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ProviderRegistry.ProviderRegistry)({
              getProviders: Effect.succeed([first, second]),
            }),
            Layer.mock(ProviderInstances.ProviderInstanceRegistry)({
              listInstances: Effect.succeed([]),
            }),
            Layer.mock(Projects.ProjectService)({}),
            Settings.layerTest({
              providerInstances: {
                [ProviderInstanceId.make("claude")]: {
                  driver: ProviderDriverKind.make("claude"),
                  config: { homePath: files.path.join(home, ".claude") },
                },
                [ProviderInstanceId.make("claude_second")]: {
                  driver: ProviderDriverKind.make("claude"),
                  config: { homePath: otherHome },
                },
              },
            }),
          ),
        ),
        Effect.provideService(HostProcess.HomeDirectory, home),
        Effect.provideService(HostProcess.Environment, {}),
      );
      const inventory = yield* catalog.inventory(null, []);
      expect(inventory.entries).toHaveLength(1);
      expect(inventory.entries[0]?.description).toBe("Native description");
      expect(
        inventory.entries[0]?.visibility.map((value) => [value.instanceId, value.enabled]),
      ).toEqual([
        ["claude", true],
        ["claude_second", false],
      ]);
      const target = inventory.targets.find((value) => value.label === "Shared Claude folder");
      expect(target).toMatchObject({ seenBy: ["claude", "claude_second"], isDefault: true });
      expect(inventory.entries[0]?.locations.some((location) => location.viaSymlink)).toBe(true);
      expect(
        inventory.accounts.find((account) => account.instanceId === "claude_second")?.homePath,
      ).toBe(otherHome);
    }),
  ).pipe(Effect.provide(base)),
);
