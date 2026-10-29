import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import {
  AGENT_TOOL_FAMILIES,
  DEFAULT_AGENT_TOOL_FAMILIES,
  type AgentToolFamily,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClientRequest, HttpIncomingMessage } from "effect/http";
import { ProjectionStoreV2 } from "../../orchestration-v2/ProjectionStore.ts";
import { ProjectStoreV2 } from "../../orchestration-v2/ProjectStore.ts";
import { ProjectProfileService } from "../project-profiles/ProjectProfileService.ts";
import { LibraryWorkspaceStore } from "../project-library/LibraryWorkspaceStore.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { SitesService } from "../sites/SitesService.ts";
import { reachZoneFromEnv } from "../reach/library/credentials.ts";
import { isLibraryAuthorityEnv } from "../project-library/authority.ts";

export const SESSION_TOOL_CONTEXT_ROUTE = "/api/loom/mcp/tool-context";
export const SessionToolContext = Schema.Struct({ reach: Schema.Boolean, sites: Schema.Boolean });
export type SessionToolContext = typeof SessionToolContext.Type;
const NO_CONTEXT: SessionToolContext = { reach: false, sites: false };
const MARKER_CACHE_MS = 30_000;
const MAX_PACKAGE_BYTES = 64 * 1024;
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export const hardwareMarkers = Effect.fn("SessionToolPolicy.hardwareMarkers")(
  function* (root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const names = yield* fs.readDirectory(root);
    for (const name of names) {
      if (
        !/\.(?:kicad_pro|kicad_pcb|kicad_sch|scad)$/i.test(name) &&
        !/^tscircuit\.config\.[cm]?[jt]s$/.test(name)
      )
        continue;
      if (
        yield* fs.stat(path.join(root, name)).pipe(
          Effect.map((stat) => stat.type === "File"),
          Effect.orElseSucceed(() => false),
        )
      )
        return true;
    }
    const packagePath = path.join(root, "package.json");
    if (!(yield* fs.exists(packagePath))) return false;
    const canonicalRoot = yield* fs.realPath(root);
    const canonicalPackage = yield* fs.realPath(packagePath);
    if (
      path.dirname(canonicalPackage) !== canonicalRoot ||
      (yield* fs.stat(packagePath)).size > MAX_PACKAGE_BYTES
    )
      return false;
    const source = yield* fs.readFileString(packagePath);
    if (Buffer.byteLength(source) > MAX_PACKAGE_BYTES) return false;
    const packageJson = yield* decodeJson(source);
    if (!packageJson || typeof packageJson !== "object") return false;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const dependencies = Reflect.get(packageJson, field);
      if (
        dependencies &&
        typeof dependencies === "object" &&
        Object.keys(dependencies).some(
          (name) => name === "tscircuit" || name.startsWith("@tscircuit/"),
        )
      )
        return true;
    }
    return false;
  },
  Effect.orElseSucceed(() => false),
);

export class SessionToolPolicy extends Context.Service<
  SessionToolPolicy,
  {
    readonly forThread: (threadId: ThreadId) => Effect.Effect<ReadonlySet<AgentToolFamily>>;
    readonly localContext: (projectId?: string) => Effect.Effect<SessionToolContext>;
    readonly isAuthority: boolean;
  }
>()("t3/fork/mcp/SessionToolPolicy") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStoreV2;
  const projections = yield* ProjectionStoreV2;
  const profiles = yield* ProjectProfileService;
  const workspaces = yield* LibraryWorkspaceStore;
  const connection = yield* LibraryConnectionService;
  const directory = yield* DirectoryService;
  const sites = yield* SitesService;
  const env = yield* HostProcess.Environment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const isAuthority = isLibraryAuthorityEnv(env);
  const markers = new Map<ProjectId, { root: string; until: number; value: boolean }>();
  const localContext = Effect.fn("SessionToolPolicy.localContext")(function* (projectId?: string) {
    const snapshot =
      projectId === undefined ? null : yield* sites.snapshot.pipe(Effect.orElseSucceed(() => null));
    return {
      reach: isAuthority && reachZoneFromEnv(env) !== null,
      sites:
        projectId !== undefined &&
        snapshot?.snapshot?.sites.some((site) => site.projectIds?.includes(projectId)) === true,
    };
  });
  const context = Effect.fn("SessionToolPolicy.context")(
    function* (projectId: string | undefined) {
      const current = yield* connection.current;
      if (current.kind === "authority") return yield* localContext(projectId);
      if (current.kind !== "remote") return NO_CONTEXT;
      const response = yield* current
        .send(
          HttpClientRequest.post(current.endpoint(SESSION_TOOL_CONTEXT_ROUTE)).pipe(
            HttpClientRequest.bodyText(
              yield* encodeJson(projectId ? { projectId } : {}),
              "application/json",
            ),
          ),
        )
        .pipe(Effect.option);
      if (Option.isNone(response)) return NO_CONTEXT;
      if (response.value.status === 404) {
        const reach = yield* directory.reachComputers.pipe(
          Effect.map((value) => value.setup.zone !== null),
          Effect.orElseSucceed(() => false),
        );
        return { reach, sites: false };
      }
      if (response.value.status !== 200) return NO_CONTEXT;
      return yield* response.value.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(4)),
        Effect.flatMap(Schema.decodeUnknownEffect(SessionToolContext)),
        Effect.orElseSucceed(() => NO_CONTEXT),
      );
    },
    Effect.timeoutOption("5 seconds"),
    Effect.map(Option.getOrElse(() => NO_CONTEXT)),
  );
  return SessionToolPolicy.of({
    isAuthority,
    localContext,
    forThread: Effect.fn("SessionToolPolicy.forThread")(
      function* (threadId) {
        const thread = yield* projections.getThread(threadId);
        const profile = yield* profiles.get(thread.projectId);
        const preferences = profile.agentToolFamilies ?? DEFAULT_AGENT_TOOL_FAMILIES;
        const enabled = new Set<AgentToolFamily>(
          AGENT_TOOL_FAMILIES.filter((family) => preferences[family] === "always"),
        );
        if (preferences.hardware === "auto") {
          const project = yield* projects
            .get(thread.projectId)
            .pipe(Effect.orElseSucceed(() => Option.none()));
          const root = thread.worktreePath ?? Option.getOrNull(project)?.workspaceRoot;
          if (root) {
            const now = yield* Clock.currentTimeMillis;
            let saved = markers.get(thread.projectId);
            if (!saved || saved.root !== root || saved.until <= now) {
              const value = yield* hardwareMarkers(root).pipe(
                Effect.provideService(FileSystem.FileSystem, fs),
                Effect.provideService(Path.Path, path),
              );
              saved = { root, until: now + MARKER_CACHE_MS, value };
              markers.set(thread.projectId, saved);
            }
            if (saved.value) enabled.add("hardware");
          }
        }
        if (preferences.reach === "auto" || preferences.sites === "auto") {
          const project = yield* workspaces
            .getBoundProject(threadId)
            .pipe(Effect.orElseSucceed(() => null));
          const evidence = yield* context(project?.id);
          if (preferences.reach === "auto" && evidence.reach) enabled.add("reach");
          if (preferences.sites === "auto" && evidence.sites) enabled.add("sites");
        }
        return enabled;
      },
      Effect.orElseSucceed(() => new Set<AgentToolFamily>()),
    ),
  });
});
export const layer = Layer.effect(SessionToolPolicy, make);
