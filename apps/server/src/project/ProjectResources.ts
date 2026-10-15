import {
  PROJECT_RESOURCES_LIMIT,
  ProjectResource,
  ProjectResourceUpsertRequest,
  ProjectResourceRemoveRequest,
  ProjectResourcesSnapshot,
  ProjectResourcesError,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

export class ProjectResources extends Context.Service<
  ProjectResources,
  {
    readonly get: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<ProjectResourcesSnapshot, ProjectResourcesError>;
    readonly upsert: (
      input: ProjectResourceUpsertRequest,
    ) => Effect.Effect<ProjectResourcesSnapshot, ProjectResourcesError>;
    readonly remove: (
      input: ProjectResourceRemoveRequest,
    ) => Effect.Effect<ProjectResourcesSnapshot, ProjectResourcesError>;
  }
>()("t3/project/ProjectResources") {}

const StoredResources = Schema.Struct({
  version: Schema.Literal(1),
  ...ProjectResourcesSnapshot.fields,
});
const StoredResourcesJson = Schema.fromJsonString(StoredResources);
const decodeStoredResources = Schema.decodeEffect(StoredResourcesJson);
const encodeStoredResources = Schema.encodeEffect(StoredResourcesJson);
const decodeUpsert = Schema.decodeEffect(ProjectResourceUpsertRequest);
const decodeRemove = Schema.decodeEffect(ProjectResourceRemoveRequest);
const unsafeCharacters = /[\p{Cc}\p{Cf}\\]/u;
const unsafeRepositoryCharacters = /[\s\p{Cc}\p{Cf}\\]/u;

/** HTTP URL parsing canonicalizes numeric SSH hosts without contacting them. */
function machineLocalHost(hostname: string): boolean {
  let host: string;
  try {
    host = new URL(`http://${hostname}/`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return true;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::]" ||
    host === "[::1]" ||
    host === "[::ffff:0:0]" ||
    /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]+\]$/.test(host)
  );
}

/** Saving a source URL never contacts its host or opens the project's working files. */
function normalizeResource(resource: ProjectResource): ProjectResource | null {
  const raw = resource.url;
  if (unsafeCharacters.test(raw)) return null;
  let remote = raw.trim();
  if (resource.kind === "repository") {
    if (unsafeRepositoryCharacters.test(remote)) return null;
    const scp = /^([a-zA-Z0-9._-]+)@([^@:/]+):([^?#]+)$/.exec(remote);
    if (scp) remote = `ssh://${scp[1]}@${scp[2]}/${scp[3]}`;
  }
  try {
    const url = new URL(remote);
    if (!url.hostname || url.password) return null;
    if (unsafeCharacters.test(decodeURIComponent(url.pathname))) return null;
    if (resource.kind === "link") {
      if (!["http:", "https:"].includes(url.protocol) || url.username) return null;
    } else {
      if (!["https:", "ssh:"].includes(url.protocol)) return null;
      if (url.username && (url.protocol !== "ssh:" || !/^[a-zA-Z0-9._-]+$/.test(url.username)))
        return null;
      if (url.search || url.hash || machineLocalHost(url.hostname)) return null;
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length < 2 || segments.some((segment) => segment === "." || segment === ".."))
        return null;
      // Repository resources name the clone source, while GitHub issue and PR URLs are links.
      if (url.hostname === "github.com" && segments.length !== 2) return null;
      url.pathname = `/${segments.join("/")}`;
    }
    return { ...resource, title: resource.title.trim(), url: url.toString() };
  } catch {
    return null;
  }
}

function resourceKey(resource: ProjectResource): string {
  return resource.kind === "repository"
    ? `repository:${canonicalRepositoryKey(normalizeGitRemoteUrl(resource.url))}`
    : `link:${resource.url}`;
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const lock = yield* Semaphore.make(1);
  const resourcesRoot = path.join(config.stateDir, "fork", "project-resources");
  const filePath = (projectId: ProjectId) =>
    path.join(resourcesRoot, `project-${Buffer.from(projectId).toString("base64url")}.json`);
  const ensureProject = Effect.fnUntraced(function* (projectId: ProjectId) {
    const project = yield* projects
      .get(projectId)
      .pipe(
        Effect.mapError((cause) => new ProjectResourcesError({ projectId, reason: "io", cause })),
      );
    if (Option.isNone(project) || project.value.deletedAt !== null)
      return yield* new ProjectResourcesError({ projectId, reason: "not-found" });
  });
  const load = Effect.fnUntraced(function* (projectId: ProjectId) {
    yield* ensureProject(projectId);
    const contents = yield* fs.readFileString(filePath(projectId)).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(null),
      ),
      Effect.mapError((cause) => new ProjectResourcesError({ projectId, reason: "io", cause })),
    );
    if (contents === null) return { projectId, revision: 0, resources: [] };
    const saved = yield* decodeStoredResources(contents).pipe(
      Effect.mapError((cause) => new ProjectResourcesError({ projectId, reason: "io", cause })),
    );
    if (
      saved.projectId !== projectId ||
      saved.resources.some((resource) => normalizeResource(resource) === null) ||
      new Set(saved.resources.map(resourceKey)).size !== saved.resources.length ||
      new Set(saved.resources.map((resource) => resource.id)).size !== saved.resources.length
    )
      return yield* new ProjectResourcesError({ projectId, reason: "io" });
    return { projectId, revision: saved.revision, resources: saved.resources };
  });
  const save = Effect.fnUntraced(function* (snapshot: ProjectResourcesSnapshot) {
    // Check again after reading metadata, so a removed project cannot acquire new resources.
    yield* ensureProject(snapshot.projectId);
    const contents = yield* encodeStoredResources({
      version: 1,
      ...snapshot,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectResourcesError({ projectId: snapshot.projectId, reason: "io", cause }),
      ),
    );
    yield* writeFileStringAtomically({
      filePath: filePath(snapshot.projectId),
      contents: `${contents}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new ProjectResourcesError({ projectId: snapshot.projectId, reason: "io", cause }),
      ),
    );
    return snapshot;
  });
  const get = Effect.fn("ProjectResources.get")(function* (input: {
    readonly projectId: ProjectId;
  }) {
    return yield* load(input.projectId);
  }, lock.withPermit);
  const upsert = Effect.fn("ProjectResources.upsert")(function* (
    input: ProjectResourceUpsertRequest,
  ) {
    const decoded = yield* decodeUpsert(input).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectResourcesError({
            projectId: input.projectId,
            reason: "invalid-resource",
            cause,
          }),
      ),
    );
    const resource = normalizeResource(decoded.resource);
    if (resource === null)
      return yield* new ProjectResourcesError({
        projectId: input.projectId,
        reason: "invalid-resource",
      });
    const current = yield* load(input.projectId);
    if (decoded.expectedRevision !== current.revision)
      return yield* new ProjectResourcesError({
        projectId: input.projectId,
        reason: "stale-revision",
      });
    const existing = current.resources.find((entry) => entry.id === resource.id);
    if (
      current.resources.some(
        (entry) => entry.id !== resource.id && resourceKey(entry) === resourceKey(resource),
      )
    )
      return yield* new ProjectResourcesError({
        projectId: input.projectId,
        reason: "duplicate-resource",
      });
    if (!existing && current.resources.length >= PROJECT_RESOURCES_LIMIT)
      return yield* new ProjectResourcesError({ projectId: input.projectId, reason: "limit" });
    if (
      existing?.kind === resource.kind &&
      existing.title === resource.title &&
      existing.url === resource.url
    )
      return current;
    const resources = existing
      ? current.resources.map((entry) => (entry.id === resource.id ? resource : entry))
      : [...current.resources, resource];
    return yield* save({ projectId: input.projectId, revision: current.revision + 1, resources });
  }, lock.withPermit);
  const remove = Effect.fn("ProjectResources.remove")(function* (
    input: ProjectResourceRemoveRequest,
  ) {
    const decoded = yield* decodeRemove(input).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectResourcesError({
            projectId: input.projectId,
            reason: "invalid-resource",
            cause,
          }),
      ),
    );
    const current = yield* load(input.projectId);
    if (decoded.expectedRevision !== current.revision)
      return yield* new ProjectResourcesError({
        projectId: input.projectId,
        reason: "stale-revision",
      });
    const resources = current.resources.filter((resource) => resource.id !== decoded.resourceId);
    if (resources.length === current.resources.length) return current;
    return yield* save({ projectId: input.projectId, revision: current.revision + 1, resources });
  }, lock.withPermit);
  return ProjectResources.of({ get, upsert, remove });
});
export const layer = Layer.effect(ProjectResources, make);
