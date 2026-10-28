import * as Path from "effect/Path";
import { ClaudeSettings, CodexSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { resolveClaudeHomePath } from "../../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../../provider/Drivers/CodexHomeLayout.ts";
import * as ServerSettings from "../../serverSettings.ts";
import type { ProjectId, ServerProvider, ServerProviderSkill } from "@t3tools/contracts";
import type {
  SkillRegistryAccount,
  SkillRegistryEntry,
  SkillRegistryInstall,
  SkillRegistryScope,
  SkillRegistryTarget,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import * as ProviderInstances from "../../provider/ProviderInstanceRegistry.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import { fail, makeSkillFiles } from "./SkillFiles.ts";
import { validateSkill } from "./validation.ts";

const decodeClaude = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeCodex = Schema.decodeUnknownEffect(CodexSettings);

interface SkillRoot {
  readonly id: string;
  readonly path: string;
  readonly scope: SkillRegistryScope;
  readonly label: string;
  readonly providers: readonly string[];
}
const knownScope = (scope: string | undefined): SkillRegistryScope =>
  scope === "repo" || scope === "project"
    ? "project"
    : scope === "plugin" || scope === "system" || scope === "admin"
      ? scope
      : "user";

export const makeSkillCatalog = Effect.gen(function* () {
  const files = yield* makeSkillFiles;
  const registry = yield* ProviderRegistry.ProviderRegistry;
  const instances = yield* ProviderInstances.ProviderInstanceRegistry;
  const projects = yield* ProjectService.ProjectService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const baseEnv = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;
  const { fs, path } = files;
  const projectRoot = Effect.fn("SkillCatalog.projectRoot")(function* (
    projectId: ProjectId | null,
  ) {
    if (projectId === null) return null;
    const project = yield* projects.getById(projectId);
    if (Option.isNone(project))
      return yield* fail("not-found", "The selected project no longer exists.");
    return project.value.workspaceRoot;
  });
  const context = Effect.fn("SkillCatalog.context")(
    function* (projectId: ProjectId | null) {
      const cwd = yield* projectRoot(projectId);
      const providers = yield* registry.getProviders;
      const settings = yield* settingsService.getSettings;
      const accounts = yield* Effect.forEach(providers, (provider) =>
        Effect.gen(function* () {
          const configured = settings.providerInstances[provider.instanceId];
          const environment = yield* mergeProviderInstanceEnvironment(
            configured?.environment,
            baseEnv,
          );
          const configuredHome =
            provider.runtimePaths?.homePath ??
            (provider.driver === "claude"
              ? yield* decodeClaude(configured?.config ?? {}).pipe(
                  Effect.flatMap((config) => resolveClaudeHomePath(config, environment)),
                  Effect.orElseSucceed(() => null),
                )
              : provider.driver === "codex"
                ? yield* decodeCodex(configured?.config ?? {}).pipe(
                    Effect.flatMap(resolveCodexHomeLayout),
                    Effect.map((layout) => layout.sharedHomePath),
                    Effect.orElseSucceed(() => null),
                  )
                : null);
          return {
            instanceId: provider.instanceId,
            driver: provider.driver,
            label: provider.displayName ?? provider.instanceId,
            homePath: configuredHome,
            enabled: provider.enabled,
            installed: provider.installed,
          } satisfies SkillRegistryAccount;
        }),
      );
      const roots: SkillRoot[] = [
        {
          id: "claudeShared",
          path: path.join(home, ".claude", "skills"),
          scope: "user",
          label: "Shared Claude folder",
          providers: ["claude"],
        },
        {
          id: "agentsUser",
          path: path.join(home, ".agents", "skills"),
          scope: "user",
          label: "All agents",
          providers: ["codex", "cursor", "grok"],
        },
      ];
      for (const account of accounts)
        if (
          account.homePath !== null &&
          (account.driver === "claude" || account.driver === "codex")
        )
          roots.push({
            id: `account:${account.instanceId}`,
            path: path.join(account.homePath, "skills"),
            scope: "user",
            label: `${account.label} skills`,
            providers: [account.driver],
          });
      for (const name of [".cursor", ".grok", ".codex"])
        roots.push({
          id: `user:${name}`,
          path: path.join(home, name, "skills"),
          scope: "user",
          label: `${name.slice(1)} user skills`,
          providers: [name.slice(1)],
        });
      if (cwd !== null)
        for (const name of [".claude", ".agents", ".cursor", ".codex", ".grok", ".opencode"])
          roots.push({
            id: `project:${name}`,
            path: path.join(cwd, name, "skills"),
            scope: "project",
            label: `Project ${name} skills`,
            providers: name === ".agents" ? ["codex", "cursor", "grok"] : [name.slice(1)],
          });
      const realRoots = yield* Effect.forEach(roots, (root) =>
        files.realOrProjected(root.path).pipe(Effect.map((realPath) => ({ ...root, realPath }))),
      );
      const targets: SkillRegistryTarget[] = [];
      for (const root of realRoots.filter(
        (root) =>
          root.id === "claudeShared" ||
          root.id === "agentsUser" ||
          root.id.startsWith("account:") ||
          root.scope === "project",
      )) {
        if (targets.some((target) => target.realPath === root.realPath)) continue;
        const seenBy = accounts
          .filter(
            (account) =>
              root.providers.includes(account.driver) &&
              (root.scope === "project" ||
                root.id === "agentsUser" ||
                realRoots.some(
                  (other) =>
                    other.id === `account:${account.instanceId}` &&
                    other.realPath === root.realPath,
                )),
          )
          .map((account) => account.instanceId);
        targets.push({
          id: yield* files.hash(root.realPath),
          path: root.path,
          realPath: root.realPath,
          scope: root.scope,
          label: root.label,
          seenBy,
          isDefault: false,
        });
      }
      const preferred =
        targets.find(
          (target) => target.label === "Shared Claude folder" && target.seenBy.length > 0,
        ) ??
        targets.find(
          (target) =>
            target.scope === "user" &&
            target.seenBy.some((id) =>
              accounts.some((account) => account.instanceId === id && account.driver === "claude"),
            ),
        ) ??
        targets.find((target) => target.label === "All agents");
      return {
        cwd,
        providers,
        accounts,
        roots: realRoots,
        targets: targets.map((target) => ({ ...target, isDefault: target.id === preferred?.id })),
      };
    },
    Effect.provideService(Path.Path, path),
  );
  const inventory = Effect.fn("SkillCatalog.inventory")(function* (
    projectId: ProjectId | null,
    installs: readonly SkillRegistryInstall[],
  ) {
    const current = yield* context(projectId);
    const unavailable: Array<{ instanceId: ServerProvider["instanceId"]; reason: string }> = [];
    const live = yield* instances.listInstances;
    const reports = yield* Effect.forEach(
      current.providers,
      (provider) =>
        Effect.gen(function* () {
          let skills = provider.skills;
          const instance = live.find((value) => value.instanceId === provider.instanceId);
          if (
            current.cwd !== null &&
            instance?.snapshotForCwd &&
            provider.enabled &&
            provider.installed
          ) {
            const result = yield* instance
              .snapshotForCwd(current.cwd)
              .pipe(Effect.timeout("20 seconds"), Effect.result);
            if (result._tag === "Success") skills = result.success.skills;
            else
              unavailable.push({
                instanceId: provider.instanceId,
                reason: "Could not read this account's project skill catalog. Retry the refresh.",
              });
          }
          return { provider, skills };
        }),
      { concurrency: 2 },
    );
    const entries = new Map<string, SkillRegistryEntry>();
    let scanned = 0;
    let scanTruncated = false;
    const add = Effect.fn("SkillCatalog.add")(function* (
      skillPath: string,
      rootId: string,
      scope: SkillRegistryScope,
      reported?: { provider: ServerProvider; skill: ServerProviderSkill },
    ) {
      if (scanned++ >= 2000) {
        scanTruncated = true;
        return;
      }
      const directory =
        path.basename(skillPath) === "SKILL.md" ? path.dirname(skillPath) : skillPath;
      const realDir = yield* fs.realPath(directory);
      const existing = entries.get(realDir);
      let entry = existing;
      if (entry === undefined) {
        const skill = yield* files.read(path.join(realDir, "SKILL.md"));
        const validation = validateSkill(skill.text, path.basename(directory));
        const tree = yield* files.tree(realDir);
        const containsScripts = tree.some(
          (file) => file.executable || file.relativePath.startsWith("scripts/"),
        );
        const install = installs.find((value) => value.directory === realDir) ?? null;
        const currentHash = install === null ? null : yield* files.treeHash(realDir);
        const writableRoot = current.targets.some(
          (target) => files.within(target.realPath, realDir) && target.realPath !== realDir,
        );
        const fileIsLocal =
          (yield* fs.realPath(path.join(realDir, "SKILL.md"))) === path.join(realDir, "SKILL.md");
        entry = {
          key: realDir,
          name: reported?.skill.name ?? validation.name ?? path.basename(directory),
          description: reported?.skill.description ?? validation.description,
          locations: [],
          visibility: [],
          install,
          editable:
            writableRoot &&
            fileIsLocal &&
            scope !== "plugin" &&
            scope !== "system" &&
            scope !== "admin",
          containsScripts,
          currentHash,
          modified: install !== null && currentHash !== install.hash,
          problems: [
            ...validation.issues,
            ...(containsScripts
              ? [
                  {
                    severity: "warning" as const,
                    code: "containsScripts",
                    message:
                      "This skill contains scripts or executable files. Loom never runs them during installation.",
                  },
                ]
              : []),
          ],
        };
        entries.set(realDir, entry);
      }
      if (!entry.locations.some((location) => location.path === directory))
        entry = {
          ...entry,
          locations: [
            ...entry.locations,
            { path: directory, realDir, viaSymlink: directory !== realDir, rootId },
          ],
        };
      if (
        reported &&
        !entry.visibility.some((value) => value.instanceId === reported.provider.instanceId)
      ) {
        const skillScope = knownScope(reported.skill.scope);
        entry = {
          ...entry,
          visibility: [
            ...entry.visibility,
            {
              instanceId: reported.provider.instanceId,
              driver: reported.provider.driver,
              scope: skillScope,
              enabled: reported.skill.enabled,
              userInvocationOnly: reported.skill.userInvocationOnly === true,
              userInvocable: reported.skill.userInvocable !== false,
              toggle:
                reported.provider.driver === "claude" &&
                (skillScope === "user" || skillScope === "project")
                  ? "claude"
                  : reported.provider.driver === "codex" &&
                      skillScope !== "system" &&
                      skillScope !== "admin"
                    ? "codex"
                    : "none",
            },
          ],
        };
      }
      entries.set(realDir, entry);
    });
    for (const { provider, skills } of reports)
      for (const skill of skills) {
        const scope = knownScope(skill.scope);
        const result = yield* add(skill.path, `provider:${provider.instanceId}`, scope, {
          provider,
          skill,
        }).pipe(Effect.result);
        if (result._tag === "Failure") {
          const key = `${provider.instanceId}:${skill.path}`;
          entries.set(key, {
            key,
            name: skill.name,
            description: skill.description ?? null,
            locations: [],
            visibility: [
              {
                instanceId: provider.instanceId,
                driver: provider.driver,
                scope,
                enabled: skill.enabled,
                userInvocationOnly: skill.userInvocationOnly === true,
                userInvocable: skill.userInvocable !== false,
                toggle: "none",
              },
            ],
            install: null,
            editable: false,
            containsScripts: false,
            currentHash: null,
            modified: false,
            problems: [
              {
                severity: "warning",
                code: "unreadable",
                message: "The provider reports this skill, but its folder could not be inspected.",
              },
            ],
          });
        }
      }
    for (const root of current.roots) {
      if (!(yield* fs.exists(root.path))) continue;
      const names = yield* fs.readDirectory(root.path).pipe(Effect.orElseSucceed(() => []));
      for (const name of names) {
        const directory = path.join(root.path, name);
        if (!(yield* fs.exists(path.join(directory, "SKILL.md")))) continue;
        yield* add(directory, root.id, root.scope).pipe(
          Effect.catchTags({
            SkillRegistryError: () => {
              scanTruncated = true;
              return Effect.void;
            },
          }),
          Effect.ignore,
        );
      }
    }
    for (const entry of entries.values()) {
      if (
        entry.visibility.length === 0 &&
        [...entries.values()].some(
          (other) =>
            other.key !== entry.key && other.name === entry.name && other.visibility.length > 0,
        )
      )
        entries.set(entry.key, {
          ...entry,
          problems: [
            ...entry.problems,
            {
              severity: "warning",
              code: "shadowed",
              message:
                "Another folder with this name appears in a provider's catalog. Review precedence before editing.",
            },
          ],
        });
    }
    return {
      projectId,
      entries: [...entries.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
      accounts: current.accounts,
      targets: current.targets,
      unavailable,
      scanTruncated,
      generatedAt: DateTime.formatIso(yield* DateTime.now),
    };
  });
  const refresh = Effect.fn("SkillCatalog.refresh")(function* (projectId: ProjectId | null) {
    const current = yield* context(projectId);
    yield* Effect.forEach(
      current.providers.filter((provider) => provider.enabled && provider.installed),
      (provider) =>
        Effect.gen(function* () {
          yield* registry.refreshInstance(provider.instanceId);
          if (current.cwd !== null)
            yield* registry.refreshWorkspaceSnapshot({
              instanceId: provider.instanceId,
              cwd: current.cwd,
              fresh: true,
            });
        }),
      { concurrency: 2, discard: true },
    );
  });
  return { context, inventory, refresh, files };
});
