// @effect-diagnostics nodeBuiltinImport:off - Lanes paths resolve synchronously, as ProjectLifecycleService resolves them.
import * as NodePath from "node:path";
import {
  DEFAULT_PROJECT_LIFECYCLE_CAPS,
  type ProjectLifecycleSettings,
} from "@t3tools/contracts/fork";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerConfig } from "../../config.ts";
import { LanesRoots } from "../../project/ProjectPlacement.ts";
import { makeStore } from "./store.ts";

/** An absolute lanes folder, or null for a relative path or a filesystem root. */
export const resolveLanesRoot = (setting: string, homeDir: string) => {
  const expanded = expandHomePath(setting.trim(), homeDir);
  if (!NodePath.isAbsolute(expanded)) return null;
  const resolved = NodePath.resolve(expanded);
  return NodePath.dirname(resolved) === resolved ? null : resolved;
};

export const lifecycleDefaults = (
  config: ServerConfig["Service"],
  homeDir: string,
): ProjectLifecycleSettings => ({
  // A dev server keeps its own lanes and starts disabled, so it never touches real lanes.
  enabled: config.devUrl === undefined,
  lanesRoot:
    config.devUrl === undefined
      ? `${homeDir}/Developer/lanes`
      : `${config.stateDir}/fork/project-lifecycle/lanes`,
  ...DEFAULT_PROJECT_LIFECYCLE_CAPS,
  projectCapsGb: {},
  buildSlots: null,
});

// Settings saved before validation could hold a relative path; those fall back to the default.
export const lanesRootOf = (
  settings: ProjectLifecycleSettings,
  defaults: ProjectLifecycleSettings,
  homeDir: string,
) =>
  resolveLanesRoot(settings.lanesRoot, homeDir) ??
  resolveLanesRoot(defaults.lanesRoot, homeDir) ??
  defaults.lanesRoot;

/**
 * Reads the lanes folder straight from the stored settings, so placement guards get it without
 * depending on ProjectLifecycleService, which itself depends on ProjectService.
 */
const makeLanesRoots = Effect.gen(function* () {
  const homeDir = yield* HostProcess.HomeDirectory;
  const config = yield* ServerConfig;
  const sql = yield* SqlClient.SqlClient;
  const store = yield* makeStore;
  const defaults = lifecycleDefaults(config, homeDir);
  const hasLifecycleStore = sql<{
    readonly name: string;
  }>`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'fork_project_lifecycle_settings'`.pipe(
    Effect.map((rows) => rows.length > 0),
  );
  return LanesRoots.of({
    roots: Effect.gen(function* () {
      // The server migrates before it serves, so only a host or test without lanes lacks it.
      if (!(yield* hasLifecycleStore)) return [];
      return [lanesRootOf(yield* store.getSettings(defaults), defaults, homeDir)];
    }).pipe(Effect.orDie),
  });
});

export const layer = Layer.effect(LanesRoots, makeLanesRoots);
