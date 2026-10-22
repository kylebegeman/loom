import type { ProjectId, ThreadId, ProjectScript } from "@t3tools/contracts";
import {
  ProjectProfileError,
  type ProjectProfile,
  type ProjectProfileTarget,
  type ProjectProfileUpdate,
  type ProjectProfilesSettings,
  type VarlockCommandInput,
  type EnvReport,
  type BudgetStatus,
  type VarlockValidation,
} from "@t3tools/contracts/fork";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as EnvInspector from "./EnvInspectorLive.ts";
import * as VarlockRunner from "./VarlockRunner.ts";
import { makeStore } from "./ProfileStore.ts";
import { serverLocalDay } from "./budget.ts";
import { buildVarlockCommandLine } from "./varlock.ts";

export function resolveIntent(
  profile: ProjectProfile,
  scripts: ReadonlyArray<ProjectScript>,
  input: VarlockCommandInput["target"],
): string | null {
  const target =
    "intent" in input
      ? profile.commands[input.intent]
      : { _tag: "action" as const, scriptId: input.scriptId };
  if (!target) return null;
  return target._tag === "command"
    ? target.command
    : (scripts.find((s) => s.id === target.scriptId)?.command ?? null);
}
export function profileSummary(
  profile: ProjectProfile,
  scripts: ReadonlyArray<ProjectScript>,
  report: EnvReport | null,
): string {
  const commands = Object.keys(profile.commands).flatMap((intent) => {
    const target = profile.commands[intent as keyof ProjectProfile["commands"]];
    if (!target) return [];
    const command =
      target._tag === "command"
        ? target.command
        : scripts.find((s) => s.id === target.scriptId)?.command;
    return command ? [`${intent}: ${command}`] : [`${intent}: action unavailable`];
  });
  const lines =
    report?.items.map(
      (item) =>
        `${item.key}  ${item.type ?? "string"}  ${item.required ? "required" : "optional"}  ${item.sensitive ? "sensitive" : "public"}  ${item.status._tag}`,
    ) ?? [];
  // Reserve room for command/env context even when the private notes fill their 8k limit.
  return [
    `Project notes:\n${profile.agentNotes.slice(0, 3500)}`,
    "Commands:",
    ...commands.map((c) => c.slice(0, 300)),
    "Env status (values omitted):",
    ...lines,
  ]
    .join("\n")
    .slice(0, 6000);
}
export class ProjectProfileService extends Context.Service<
  ProjectProfileService,
  {
    readonly get: (projectId: ProjectId) => Effect.Effect<ProjectProfile, ProjectProfileError>;
    readonly update: (
      input: ProjectProfileUpdate,
    ) => Effect.Effect<ProjectProfile, ProjectProfileError>;
    readonly reset: (projectId: ProjectId) => Effect.Effect<ProjectProfile, ProjectProfileError>;
    readonly envReport: (
      input: ProjectProfileTarget,
    ) => Effect.Effect<EnvReport, ProjectProfileError>;
    readonly varlockValidate: (
      input: ProjectProfileTarget,
    ) => Effect.Effect<VarlockValidation, ProjectProfileError>;
    readonly varlockCommand: (
      input: VarlockCommandInput,
    ) => Effect.Effect<{ commandLine: string; cwd: string }, ProjectProfileError>;
    readonly budgetStatus: (
      input: ProjectProfileTarget,
    ) => Effect.Effect<BudgetStatus, ProjectProfileError>;
    readonly getSettings: Effect.Effect<ProjectProfilesSettings, ProjectProfileError>;
    readonly updateSettings: (
      settings: ProjectProfilesSettings,
    ) => Effect.Effect<ProjectProfilesSettings, ProjectProfileError>;
    readonly forAgent: (
      threadId: ThreadId,
      includeEnv: boolean,
    ) => Effect.Effect<string, ProjectProfileError>;
  }
>()("t3/fork/project-profiles/ProjectProfileService") {}
const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const env = yield* EnvInspector.EnvInspector;
  const varlock = yield* VarlockRunner.VarlockRunner;
  const os = yield* HostProcess.Platform;
  const store = yield* makeStore;
  const lock = yield* Semaphore.make(1);
  const project = Effect.fn("ProjectProfiles.project")(function* (projectId: ProjectId) {
    const found = yield* projects
      .get(projectId)
      .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })));
    if (Option.isNone(found))
      return yield* new ProjectProfileError({ reason: "project-not-found" });
    return found.value;
  });
  const checkout = Effect.fn("ProjectProfiles.checkout")(function* (input: ProjectProfileTarget) {
    const found = yield* project(input.projectId);
    if (!input.threadId) return found.workspaceRoot;
    const thread = yield* projections
      .getThreadShell(input.threadId)
      .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "thread-not-found" })));
    if (!thread || thread.deletedAt || thread.projectId !== input.projectId)
      return yield* new ProjectProfileError({ reason: "thread-not-found" });
    return thread.worktreePath ?? found.workspaceRoot;
  });
  const get = Effect.fn("ProjectProfiles.get")(function* (projectId: ProjectId) {
    yield* project(projectId);
    return yield* store.get(projectId);
  });
  const update = Effect.fn("ProjectProfiles.update")(function* (input: ProjectProfileUpdate) {
    const current = yield* get(input.projectId);
    const next = {
      ...current,
      ...input.patch,
      projectId: input.projectId,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    return yield* store.put(next);
  }, lock.withPermit);
  const envReport = Effect.fn("ProjectProfiles.envReport")(function* (input: ProjectProfileTarget) {
    const root = yield* checkout(input);
    const profile = yield* store.get(input.projectId);
    const report = yield* env.inspect(root, profile.env.schemaPath);
    return { ...report, varlock: yield* varlock.detect };
  });
  const scriptsFor = Effect.fn("ProjectProfiles.scripts")(function* (projectId: ProjectId) {
    const found = yield* project(projectId);
    const config = yield* settings.getSettings.pipe(
      Effect.mapError(() => new ProjectProfileError({ reason: "read-failed" })),
    );
    return resolveProjectScripts(config, { id: projectId, scripts: found.scripts });
  });
  return ProjectProfileService.of({
    get,
    update,
    getSettings: store.getSettings,
    updateSettings: store.updateSettings,
    reset: Effect.fn("ProjectProfiles.reset")(function* (projectId: ProjectId) {
      yield* project(projectId);
      return yield* store.reset(projectId);
    }, lock.withPermit),
    envReport,
    varlockValidate: Effect.fn("ProjectProfiles.validate")(function* (input) {
      const root = yield* checkout(input);
      const profile = yield* store.get(input.projectId);
      // Resolve every configured file before invoking project code.
      yield* env.inspect(root, profile.env.schemaPath);
      return yield* varlock.validate(root, profile.env.schemaPath);
    }),
    varlockCommand: Effect.fn("ProjectProfiles.command")(function* (input) {
      const cwd = yield* checkout(input);
      const profile = yield* store.get(input.projectId);
      const command = resolveIntent(profile, yield* scriptsFor(input.projectId), input.target);
      if (!command) return yield* new ProjectProfileError({ reason: "action-not-found" });
      const report = yield* env.inspect(cwd, profile.env.schemaPath);
      const wrap =
        profile.env.varlock === "auto" &&
        report.schema._tag === "ok" &&
        (yield* varlock.detect)._tag === "available";
      const commandLine = wrap
        ? yield* Effect.try({
            try: () => buildVarlockCommandLine(command, os, profile.env.schemaPath),
            catch: () => new ProjectProfileError({ reason: "unsupported-platform" }),
          })
        : command;
      return { commandLine, cwd };
    }),
    budgetStatus: Effect.fn("ProjectProfiles.budgetStatus")(function* (input) {
      yield* checkout(input);
      return yield* store.status(
        yield* store.get(input.projectId),
        serverLocalDay(DateTime.formatIso(yield* DateTime.now)),
        input.threadId,
      );
    }),
    forAgent: Effect.fn("ProjectProfiles.forAgent")(function* (threadId, includeEnv) {
      if (!(yield* store.getSettings).agentTool)
        return yield* new ProjectProfileError({ reason: "sharing-disabled" });
      const thread = yield* projections
        .getThreadShell(threadId)
        .pipe(Effect.mapError(() => new ProjectProfileError({ reason: "thread-not-found" })));
      if (!thread || thread.deletedAt)
        return yield* new ProjectProfileError({ reason: "thread-not-found" });
      const profile = yield* get(thread.projectId);
      const report = includeEnv
        ? yield* envReport({ projectId: thread.projectId, threadId })
        : null;
      return profileSummary(profile, yield* scriptsFor(thread.projectId), report);
    }),
  });
});
export const layer = Layer.effect(ProjectProfileService, make);
