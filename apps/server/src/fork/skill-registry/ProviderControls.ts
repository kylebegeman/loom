import { ClaudeSettings, CodexSettings } from "@t3tools/contracts";
import type { SkillRegistryEntry, SkillSetEnabledInput } from "@t3tools/contracts/fork";
import { SkillRegistryError } from "@t3tools/contracts/fork";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { resolveClaudeHomePath } from "../../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../../provider/Drivers/CodexHomeLayout.ts";
import {
  findRepositoryRoot,
  skillOverrideSettingsPaths,
} from "../../provider/Drivers/ClaudeSkills.ts";
import { resolveCodexLaunchArgs } from "../../provider/codexLaunchArgs.ts";
import { withCodexAppServerClient } from "../../provider/CodexProvider.ts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { fail } from "./SkillFiles.ts";

const decodeClaude = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeCodex = Schema.decodeUnknownEffect(CodexSettings);
const settingsCodec = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeSettings = Schema.decodeUnknownEffect(settingsCodec);
const encodeSettings = Schema.encodeEffect(settingsCodec);
const decodeManaged = Schema.decodeUnknownEffect(
  fromLenientJson(
    Schema.Struct({
      skillOverrides: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
);
const isSkillError = Schema.is(SkillRegistryError);

export const makeProviderControls = Effect.gen(function* () {
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const baseEnv = yield* HostProcess.Environment;
  const nativeContext = yield* Effect.context<
    FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
  >();
  return Effect.fn("SkillRegistry.setProviderEnabled")(
    function* (input: SkillSetEnabledInput, entry: SkillRegistryEntry, cwd: string | null) {
      const providers = yield* registry.getProviders;
      const provider = providers.find((value) => value.instanceId === input.instanceId);
      const visibility = entry.visibility.find((value) => value.instanceId === input.instanceId);
      if (provider === undefined || visibility === undefined || visibility.toggle === "none")
        return yield* fail("unsupported", "This provider manages enablement in its own settings.");
      const configuration = (yield* settings.getSettings).providerInstances;
      if (provider.driver === "codex") {
        if (input.scope !== "account")
          return yield* fail(
            "unsupported",
            "Codex enablement applies to every project using this Codex home.",
          );
        const configured = configuration[input.instanceId];
        const config = yield* decodeCodex(configured?.config ?? {});
        const environment = yield* mergeProviderInstanceEnvironment(
          configured?.environment,
          baseEnv,
        );
        const layout = yield* resolveCodexHomeLayout(config);
        const homePath =
          provider.runtimePaths?.shadowHomePath ??
          provider.runtimePaths?.homePath ??
          layout.effectiveHomePath ??
          layout.sharedHomePath;
        const changed = yield* Effect.scoped(
          Effect.gen(function* () {
            const { client } = yield* withCodexAppServerClient({
              binaryPath: config.binaryPath,
              homePath,
              launchArgs: resolveCodexLaunchArgs(config.launchArgs, environment),
              cwd: cwd ?? homePath,
              environment,
            });
            return yield* client.request("skills/config/write", {
              path: path.join(entry.key, "SKILL.md"),
              enabled: input.enabled,
            });
          }),
        ).pipe(Effect.provideContext(nativeContext));
        if (changed.effectiveEnabled !== input.enabled)
          return yield* fail(
            "read-only",
            "Codex policy kept the skill's effective state unchanged.",
          );
        return;
      }
      if (provider.driver !== "claude")
        return yield* fail("unsupported", "Change this provider's skills in its own settings.");
      if (input.scope === "project" && cwd === null)
        return yield* fail("invalid", "Choose a project before changing its skill settings.");
      const accounts =
        input.scope === "allAccounts"
          ? providers.filter((value) => value.driver === "claude")
          : [provider];
      const updates = new Map<string, { contents: string | null; next: string }>();
      for (const account of accounts) {
        const configured = configuration[account.instanceId];
        const config = yield* decodeClaude(configured?.config ?? {});
        const environment = yield* mergeProviderInstanceEnvironment(
          configured?.environment,
          baseEnv,
        );
        const home = yield* resolveClaudeHomePath(config, environment);
        const repoRoot =
          cwd === null
            ? undefined
            : yield* findRepositoryRoot(cwd).pipe(Effect.provideContext(nativeContext));
        const paths = skillOverrideSettingsPaths(
          path,
          home,
          cwd ?? undefined,
          platform,
          environment,
          repoRoot,
        );
        const managed = paths.find((file) => file.endsWith("managed-settings.json"));
        if (managed !== undefined && (yield* fs.exists(managed))) {
          const policy = yield* fs.readFileString(managed).pipe(Effect.flatMap(decodeManaged));
          if (policy.skillOverrides?.[entry.name] !== undefined)
            return yield* fail(
              "read-only",
              "Managed Claude settings control this skill. Change that policy at its source.",
            );
        }
        const file =
          input.scope === "project"
            ? paths.filter((value) => value.endsWith("settings.local.json")).at(-1)!
            : path.join(home, "settings.json");
        const target = yield* fs.realPath(file).pipe(Effect.orElseSucceed(() => file));
        if (updates.has(target)) continue;
        const contents = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : null;
        const parsed =
          contents === null
            ? {}
            : yield* decodeSettings(contents).pipe(
                Effect.mapError(() =>
                  fail(
                    "invalid",
                    "This Claude settings file has comments, trailing commas or invalid JSON. Edit it by hand to preserve its formatting.",
                  ),
                ),
              );
        const rawOverrides = parsed.skillOverrides;
        if (
          rawOverrides !== undefined &&
          (rawOverrides === null || typeof rawOverrides !== "object" || Array.isArray(rawOverrides))
        )
          return yield* fail(
            "invalid",
            "Claude's skillOverrides must be an object. Repair the settings file first.",
          );
        const overrides = (rawOverrides ?? {}) as Record<string, unknown>;
        if (
          Object.values(overrides).some(
            (value) => !["on", "off", "name-only", "user-invocable-only"].includes(String(value)),
          )
        )
          return yield* fail(
            "invalid",
            "Claude ignores an invalid skillOverrides map. Repair its unsupported values before changing it.",
          );
        const next = yield* encodeSettings({
          ...parsed,
          skillOverrides: { ...overrides, [entry.name]: input.enabled ? "on" : "off" },
        });
        updates.set(target, { contents, next });
      }
      const written: string[] = [];
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          for (const [file, update] of updates) {
            const current = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : null;
            if (current !== update.contents)
              return yield* fail(
                "conflict",
                "Claude settings changed while preparing the update. Refresh and retry.",
              );
            yield* writeFileStringAtomically({ filePath: file, contents: update.next }).pipe(
              Effect.provideContext(nativeContext),
            );
            written.push(file);
          }
        }),
      ).pipe(
        Effect.tapError(() =>
          Effect.forEach(
            written.toReversed(),
            (file) =>
              Effect.uninterruptible(
                Effect.gen(function* () {
                  const previous = updates.get(file)!;
                  const current = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : null;
                  if (current !== previous.next) return;
                  if (previous.contents === null) yield* fs.remove(file);
                  else
                    yield* writeFileStringAtomically({
                      filePath: file,
                      contents: previous.contents,
                    }).pipe(Effect.provideContext(nativeContext));
                }),
              ),
            { discard: true },
          ).pipe(Effect.ignore({ log: true })),
        ),
      );
    },
    Effect.mapError((cause) =>
      isSkillError(cause)
        ? cause
        : fail("io", "The provider's native skill settings could not be changed."),
    ),
    Effect.provideContext(nativeContext),
  );
});
