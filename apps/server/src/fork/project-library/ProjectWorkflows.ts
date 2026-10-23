import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  LibraryBlueprint,
  LibraryError,
  LibraryWorkstream,
  LibrarySaveWorkstream,
  type LibraryPreservationEntry,
  type LibraryProject,
  type LibraryWorkstreamReference,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Semaphore from "effect/Semaphore";
import { LibraryService } from "./LibraryService.ts";

const fail = (reason: LibraryError["reason"], message?: string) =>
  new LibraryError({ reason, ...(message ? { detail: message.slice(0, 4096) } : {}) });
const isLibraryFailure = Schema.is(LibraryError);
const decodeBlueprint = Schema.decodeUnknownEffect(LibraryBlueprint);
const encodeWorkstreamInput = Schema.encodeEffect(Schema.fromJsonString(LibrarySaveWorkstream));
const io = (cause: unknown) => (isLibraryFailure(cause) ? cause : fail("io"));
const workstreamCodec = Schema.fromJsonString(LibraryWorkstream);

export class ProjectWorkflows extends Context.Service<
  ProjectWorkflows,
  {
    readonly changes: Stream.Stream<number>;
    readonly changed: Effect.Effect<void>;
    readonly workstreams: (input: {
      projectId: string;
    }) => Effect.Effect<readonly LibraryWorkstream[], LibraryError>;
    readonly saveWorkstream: (
      input: LibrarySaveWorkstream,
    ) => Effect.Effect<LibraryWorkstream, LibraryError>;
    readonly blueprint: (input: {
      projectId: string;
    }) => Effect.Effect<LibraryBlueprint, LibraryError>;
    readonly applyBlueprint: (input: {
      requestId: string;
      projectId: string;
      expectedRevision: number;
      blueprint: LibraryBlueprint;
    }) => Effect.Effect<LibraryProject, LibraryError>;
    readonly preservation: (input: {
      projectId?: string | undefined;
    }) => Effect.Effect<readonly LibraryPreservationEntry[], LibraryError>;
  }
>()("t3/fork/project-library/ProjectWorkflows") {}

function workstreamBlockers(references: readonly LibraryWorkstreamReference[]): string[] {
  return references
    .filter((reference) => reference.state !== "passed" && reference.state !== "completed")
    .map(
      (reference) =>
        `${reference.label}: ${reference.state === "blocked" ? "blocked" : "unfinished"}`,
    );
}

function copyNeedsReview(copy: LibraryWorkingCopy | undefined): boolean {
  if (!copy) return true;
  if (copy.state === "released") return false;
  const health = copy.health;
  return (
    copy.state !== "ready" ||
    !health ||
    copy.repositories.some(
      (repository) =>
        !health.repositories.some((report) => report.resourceId === repository.resourceId),
    ) ||
    health.repositories.some(
      (repo) =>
        repo.uncommittedFiles > 0 ||
        repo.unpushedCommits > 0 ||
        repo.fetchFailed ||
        repo.error ||
        !repo.fetchedAt ||
        repo.upstreamGone,
    )
  );
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const library = yield* LibraryService;
  const lock = yield* Semaphore.make(1);
  const refreshes = yield* SubscriptionRef.make(0);
  const changed = SubscriptionRef.update(refreshes, (value) => value + 1);
  const workstreams = Effect.fn("ProjectWorkflows.workstreams")(function* (input: {
    projectId: string;
  }) {
    yield* library.project(input);
    const rows = yield* sql<{
      payload_json: string;
    }>`SELECT payload_json FROM fork_library_workstreams WHERE project_id = ${input.projectId} ORDER BY id`;
    return yield* Effect.forEach(rows, (row) =>
      Schema.decodeEffect(workstreamCodec)(row.payload_json),
    );
  }, Effect.mapError(io));
  const saveWorkstream = Effect.fn("ProjectWorkflows.saveWorkstream")(
    function* (input: LibrarySaveWorkstream) {
      yield* library.project(input);
      const request = yield* encodeWorkstreamInput(input);
      const receipts = yield* sql<{
        request_json: string;
        result_json: string;
      }>`SELECT request_json, result_json FROM fork_library_workflow_receipts WHERE id = ${input.requestId}`;
      if (receipts[0]) {
        if (receipts[0].request_json !== request) return yield* fail("request-conflict");
        return yield* Schema.decodeEffect(workstreamCodec)(receipts[0].result_json);
      }
      const rows = yield* sql<{
        payload_json: string;
      }>`SELECT payload_json FROM fork_library_workstreams WHERE id = ${input.id}`;
      const current = rows[0]
        ? yield* Schema.decodeEffect(workstreamCodec)(rows[0].payload_json)
        : null;
      if ((current?.revision ?? 0) !== input.expectedRevision)
        return yield* fail("revision-conflict");
      if (current && current.projectId !== input.projectId) return yield* fail("invalid");
      if (
        new Set(input.references.map((ref) => `${ref.kind}:${ref.environmentId ?? ""}:${ref.id}`))
          .size !== input.references.length
      )
        return yield* fail("invalid", "Each linked item can appear only once.");
      const copies = yield* library.copies({ projectId: input.projectId, includeReleased: true });
      const threads = yield* library.threads({ projectId: input.projectId });
      const project = yield* library.project(input);
      for (const ref of input.references) {
        if (ref.kind === "copy" && !copies.some((copy) => copy.id === ref.id))
          return yield* fail("invalid", "Choose a copy from this project.");
        if (
          ref.kind === "repository" &&
          !project.resources.some((resource) => resource.id === ref.id)
        )
          return yield* fail("invalid", "Choose a repository from this project.");
        if (
          ref.kind === "thread" &&
          !threads.some(
            (thread) =>
              (thread.id === ref.id || thread.threadId === ref.id) &&
              (!ref.environmentId || thread.environmentId === ref.environmentId),
          )
        )
          return yield* fail("invalid", "Choose a conversation from this project.");
        if (ref.url && !/^https:\/\/[^/@\s]+\//.test(ref.url))
          return yield* fail("invalid", "Use a public HTTPS link without credentials.");
      }
      if (input.state === "completed") {
        const blockers = workstreamBlockers(input.references);
        for (const ref of input.references) {
          if (
            ref.kind === "thread" &&
            threads.some(
              (thread) =>
                (thread.id === ref.id || thread.threadId === ref.id) &&
                (!ref.environmentId || thread.environmentId === ref.environmentId) &&
                ["preparing", "queued", "starting", "running", "waiting"].includes(thread.status),
            )
          )
            blockers.push(`${ref.label}: still running`);
          if (ref.kind === "copy") {
            const copy = copies.find((entry) => entry.id === ref.id);
            if (copyNeedsReview(copy))
              blockers.push(`${ref.label}: review local changes and remote preservation`);
          }
        }
        if (blockers.length) return yield* fail("blocked", blockers.join("; "));
      }
      const now = DateTime.formatIso(yield* DateTime.now);
      const value: LibraryWorkstream = {
        id: input.id,
        projectId: input.projectId,
        title: input.title,
        goal: input.goal,
        state: input.state,
        references: input.references,
        revision: input.expectedRevision + 1,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      const payload = yield* Schema.encodeEffect(workstreamCodec)(value);
      yield* sql`INSERT INTO fork_library_workstreams (id,project_id,revision,payload_json) VALUES (${value.id},${value.projectId},${value.revision},${payload}) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json`;
      yield* sql`INSERT INTO fork_library_workflow_receipts (id,request_json,result_json) VALUES (${input.requestId},${request},${payload})`;
      return value;
    },
    (effect) => sql.withTransaction(effect).pipe(lock.withPermit),
    Effect.mapError(io),
    Effect.tap(() => changed),
  );
  const blueprint = Effect.fn("ProjectWorkflows.blueprint")(function* (input: {
    projectId: string;
  }) {
    const project = yield* library.project(input);
    const {
      defaultModelSelection: _model,
      preferredEnvironmentIds: _computers,
      ...setup
    } = project.profile ?? {};
    return yield* decodeBlueprint({
      format: "loom-project",
      version: 1,
      title: project.title,
      brief: project.brief,
      resources: project.resources,
      ...(project.color ? { color: project.color } : {}),
      ...(project.profile ? { setup } : {}),
      connections: project.profile?.connectionNames ?? [],
    });
  }, Effect.mapError(io));
  const applyBlueprint = Effect.fn("ProjectWorkflows.applyBlueprint")(
    function* (input: {
      requestId: string;
      projectId: string;
      expectedRevision: number;
      blueprint: LibraryBlueprint;
    }) {
      const blueprint = yield* decodeBlueprint(input.blueprint).pipe(
        Effect.mapError(() =>
          fail(
            "invalid",
            "Review the blueprint layout, connection names and setup. Keep computer preferences and credentials out of the file.",
          ),
        ),
      );
      const project = yield* library.project(input);
      return yield* library.updateProject({
        requestId: input.requestId,
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        title: blueprint.title,
        brief: blueprint.brief,
        resources: blueprint.resources,
        color: blueprint.color ?? null,
        profile: {
          ...blueprint.setup,
          connectionNames: blueprint.connections,
          ...(project.profile?.defaultModelSelection
            ? { defaultModelSelection: project.profile.defaultModelSelection }
            : {}),
          ...(project.profile?.preferredEnvironmentIds
            ? { preferredEnvironmentIds: project.profile.preferredEnvironmentIds }
            : {}),
        },
      });
    },
    Effect.mapError(io),
    Effect.tap(() => changed),
  );
  const preservation = Effect.fn("ProjectWorkflows.preservation")(function* (input: {
    projectId?: string | undefined;
  }) {
    const projects = input.projectId
      ? [yield* library.project({ projectId: input.projectId })]
      : yield* library.projects({ includeArchived: true });
    const entries: LibraryPreservationEntry[] = [];
    for (const project of projects) {
      const copies = yield* library.copies({ projectId: project.id, includeReleased: false });
      const threads = yield* library.threads({ projectId: project.id });
      for (const copy of copies) {
        const blockers: string[] = [];
        if (
          threads.some(
            (thread) =>
              thread.workingCopyId === copy.id &&
              ["preparing", "queued", "starting", "running", "waiting"].includes(thread.status),
          )
        )
          blockers.push("Active conversations use these files.");
        if (copy.state !== "ready") blockers.push("Files are not ready on this computer.");
        const health = copy.health;
        if (
          health &&
          copy.repositories.some(
            (repository) =>
              !health.repositories.some((report) => report.resourceId === repository.resourceId),
          )
        )
          blockers.push("Some repositories have not been checked on this computer.");
        if (!copy.health)
          blockers.push("Check this computer for local changes and remote preservation.");
        else
          for (const repo of copy.health.repositories) {
            if (repo.uncommittedFiles) blockers.push(`${repo.resourceId}: uncommitted files`);
            if (repo.unpushedCommits > 0)
              blockers.push(`${repo.resourceId}: local history needs preservation`);
            if (!repo.fetchedAt || repo.fetchFailed || repo.error || repo.upstreamGone)
              blockers.push(`${repo.resourceId}: remote preservation is unverified`);
          }
        if (copy.ownership === "borrowed")
          blockers.push("Existing folder: Loom can forget it but never delete it.");
        if (!copy.recovery)
          blockers.push(
            "No verified recovery archive is recorded. Review ignored files, stashes and local-only history on the computer.",
          );
        entries.push({
          project,
          copy,
          blockers,
          restore: copy.recovery
            ? "verified-archive"
            : project.resources.some((resource) => resource.remoteUrl)
              ? "repository"
              : "unverified",
          checkedAt: copy.health?.checkedAt ?? null,
        });
      }
    }
    return entries;
  }, Effect.mapError(io));
  return {
    workstreams,
    saveWorkstream,
    blueprint,
    applyBlueprint,
    preservation,
    changed,
    changes: SubscriptionRef.changes(refreshes),
  };
});
export const layer = Layer.effect(ProjectWorkflows, make);
