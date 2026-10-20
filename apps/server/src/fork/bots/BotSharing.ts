import { ProjectId, type EnvironmentId, type ModelSelection } from "@t3tools/contracts";
import {
  BOT_LIBRARY_STATUS_FRESH_MS,
  BOTS_MAX_ACTIVE_RUNS,
  BotsError,
  isTerminalBotRunStatus,
  vaultPromptLink,
  type BotDefinition,
  type BotDefinitionInput,
  type BotLibraryDelivery,
  type BotLibraryError,
  type BotLibraryLink,
  type BotLibraryStatusReport,
  type BotRemoteSettings,
  type BotRun,
  type BotRunComputer,
  type BotSyncResult,
  type BotTarget,
  type BotTargetReadiness,
  type BotTargetsResult,
  type BotVaultBinding,
  type BotsChange,
} from "@t3tools/contracts/fork";
import { isModelSelectionProviderEnabled } from "@t3tools/shared/serverSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { forkParked } from "../../serverActivation.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as LibraryWorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";
import * as VaultReferences from "../vault/VaultReferences.ts";
import { BotLibraryClient } from "./BotLibraryClient.ts";
import { makeBotsStore } from "./BotsStore.ts";
import {
  BotsService,
  USER_CALLER,
  outranks,
  versionInput,
  type BotsAnywhereHooks,
  type BotsServiceShape,
} from "./BotsService.ts";

/** A Library long poll waits this long for work before asking again. */
const LONG_POLL_MS = 25_000;
const SYNC_INTERVAL = Duration.minutes(5);
const STATUS_INTERVAL = Duration.minutes(1);
const REPORT_SWEEP_INTERVAL = Duration.seconds(30);
const IDLE_POLL = Duration.seconds(30);
/** A target that reports nothing this long after a run's own timeout has lost the run. */
const REPORT_GRACE_MS = 15 * 60_000;
/** Before a run starts, its target may still be waiting for the Library to deliver it. */
const PICKUP_GRACE_MS = 10 * 60_000;
const FALLBACK_TIMEOUT_MINUTES = 30;

/** How a local project and its Library project name each other on this computer. */
export interface BotProjectMap {
  readonly toLibrary: (projectId: ProjectId) => Effect.Effect<string | null>;
  readonly toLocal: (libraryProjectId: string) => Effect.Effect<ProjectId | null>;
}

export interface BotVaultLookup {
  readonly describe: (
    itemId: string,
  ) => Effect.Effect<{ readonly environmentId: EnvironmentId; readonly label: string } | null>;
}

export interface BotSharingDeps {
  readonly bots: BotsServiceShape;
  readonly client: BotLibraryClient["Service"];
  readonly projects: BotProjectMap;
  readonly vault: BotVaultLookup;
  readonly modelEnabled: (model: ModelSelection) => Effect.Effect<boolean>;
}

const fail = (reason: BotsError["reason"], message: string) => new BotsError({ reason, message });
const fromLibrary = (error: BotLibraryError) =>
  fail(
    error.reason === "not_found" ? "not_found" : error.reason === "storage" ? "storage" : "invalid",
    error.message,
  );

/** The project a definition names, if any; a scoped bot and its workspace name the same one. */
const definitionProject = (definition: BotDefinitionInput): ProjectId | null =>
  definition.scopeProjectId ??
  (definition.workspace.type === "project" ? definition.workspace.projectId : null);

/**
 * Swaps the project a definition names. A shared definition names its Library project in the same
 * fields, so each computer puts its own copy back where the publisher had one.
 */
const withProject = (
  definition: BotDefinitionInput,
  projectId: ProjectId | null,
): BotDefinitionInput => ({
  ...definition,
  scopeProjectId: definition.scopeProjectId === null ? null : projectId,
  workspace:
    definition.workspace.type === "project" && definition.workspace.projectId !== null
      ? { ...definition.workspace, projectId }
      : definition.workspace,
});

const sameModel = (a: ModelSelection, b: ModelSelection) =>
  a.instanceId === b.instanceId && a.model === b.model;

export const makeSharing = Effect.fnUntraced(function* (deps: BotSharingDeps) {
  const { bots, client, projects, vault } = deps;
  const store = yield* makeBotsStore;
  // One sync at a time: the loop, a publish and a request for an unknown revision can overlap.
  const syncLock = yield* Semaphore.make(1);
  const nowMs = DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const storage = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(Effect.mapError(() => fail("storage", "Loom could not read its bot storage.")));

  const requireLibrary = Effect.gen(function* () {
    const availability = yield* client.availability();
    if (availability === "available") return;
    return yield* fail(
      "invalid",
      availability === "unsupported"
        ? "Your Library does not support shared bots yet."
        : "This computer is not connected to a Library.",
    );
  });

  /** Why this computer cannot run `bot` now; empty when it can. */
  const readiness = Effect.fnUntraced(function* (bot: BotDefinition) {
    const reasons: Array<string> = [];
    if (bot.archivedAt !== null) reasons.push("It is archived on this computer.");
    if (!(yield* deps.modelEnabled(bot.modelSelection)))
      reasons.push("Its model's provider is not set up on this computer.");
    const libraryProjectId = bot.library?.libraryProjectId ?? null;
    if (libraryProjectId !== null && (yield* projects.toLocal(libraryProjectId)) === null)
      reasons.push("This computer has no copy of its project.");
    const bindings = yield* storage(store.vaultBindings(bot.id));
    for (const slot of bot.vaultSlots ?? [])
      if (!bindings.has(slot.name))
        reasons.push(`Its Vault slot "${slot.label}" is not bound on this computer.`);
    return reasons;
  });

  const freeSlots = bots.activeRuns.pipe(
    Effect.map((active) => Math.max(0, BOTS_MAX_ACTIVE_RUNS - active)),
  );

  const statusReport = Effect.gen(function* () {
    const settings = yield* storage(store.remoteSettings());
    const shared = (yield* bots.list()).filter((bot) => bot.library != null);
    const entries: Array<BotLibraryStatusReport["bots"][number]> = [];
    for (const bot of shared.slice(0, 500)) {
      const reasons = yield* readiness(bot);
      entries.push({
        libraryBotId: bot.library!.libraryBotId,
        revision: bot.library!.revision,
        ready: reasons.length === 0,
        reasons,
      });
    }
    return {
      label: yield* client.label,
      acceptRemote: settings.acceptRemote,
      runtimeModeCeiling: settings.runtimeModeCeiling,
      freeSlots: yield* freeSlots,
      bots: entries,
    } satisfies BotLibraryStatusReport;
  });

  const reportStatus = statusReport.pipe(
    Effect.flatMap((report) => client.reportStatus(report).pipe(Effect.mapError(fromLibrary))),
  );

  const libraryProjectFor = Effect.fnUntraced(function* (definition: BotDefinitionInput) {
    const projectId = definitionProject(definition);
    if (projectId === null) return null;
    const libraryProjectId = yield* projects.toLibrary(projectId);
    if (libraryProjectId === null)
      return yield* fail(
        "invalid",
        "Add this bot's project to the Library first, so other computers can run it in their copy.",
      );
    return libraryProjectId;
  });

  const forLibrary = (definition: BotDefinitionInput, libraryProjectId: string | null) =>
    withProject(definition, libraryProjectId === null ? null : ProjectId.make(libraryProjectId));

  const share = Effect.fn("BotSharing.share")(function* (botId: string) {
    const bot = yield* bots.get(botId);
    if (bot.library != null) return bot;
    yield* requireLibrary;
    const definition = versionInput(bot);
    const libraryProjectId = yield* libraryProjectFor(definition);
    const record = yield* client
      .publish({
        definition: forLibrary(definition, libraryProjectId),
        libraryProjectId,
        expectedRevision: null,
        label: yield* client.label,
      })
      .pipe(Effect.mapError(fromLibrary));
    const shared = yield* bots.setLibraryLink(bot.id, {
      libraryBotId: record.id,
      revision: record.revision,
      libraryProjectId,
      syncedAt: yield* nowIso,
      modelOverride: null,
    });
    yield* reportStatus.pipe(Effect.ignore({ log: true }));
    return shared;
  });

  /** Stops sharing; every computer keeps its copy as an ordinary local bot. */
  const unshare = Effect.fn("BotSharing.unshare")(function* (botId: string) {
    const bot = yield* bots.get(botId);
    if (bot.library == null) return bot;
    yield* requireLibrary;
    yield* client.unpublish(bot.library.libraryBotId).pipe(Effect.mapError(fromLibrary));
    return yield* bots.setLibraryLink(bot.id, null);
  });

  /**
   * Publishes an edit to a shared bot. A new model counts as this computer's own when the bot
   * already runs on one here, or the shared model's provider is not set up here; the Library then
   * keeps the shared model.
   */
  const publishEdit = Effect.fnUntraced(function* (
    definition: BotDefinitionInput,
    link: BotLibraryLink,
  ) {
    const current = yield* bots.get(definition.id);
    const modelChanged = !sameModel(current.modelSelection, definition.modelSelection);
    const modelOverride =
      link.modelOverride !== null ||
      (modelChanged && !(yield* deps.modelEnabled(current.modelSelection)))
        ? definition.modelSelection
        : null;
    const libraryProjectId = yield* libraryProjectFor(definition);
    const record = yield* client
      .publish({
        definition: forLibrary(definition, libraryProjectId),
        libraryProjectId,
        expectedRevision: link.revision,
        label: yield* client.label,
        ...(modelOverride === null ? {} : { keepModel: true }),
      })
      .pipe(Effect.mapError(fromLibrary));
    return {
      libraryBotId: record.id,
      revision: record.revision,
      libraryProjectId,
      syncedAt: yield* nowIso,
      modelOverride,
    } satisfies BotLibraryLink;
  });

  const syncNow = Effect.gen(function* () {
    yield* requireLibrary;
    let cursor = yield* storage(store.libraryCursor());
    let pulled = 0;
    const refused: Array<BotSyncResult["refused"][number]> = [];
    while (true) {
      const page = yield* client.list(cursor).pipe(Effect.mapError(fromLibrary));
      for (const record of page.records) {
        const local = yield* bots.get(record.id).pipe(Effect.option);
        const existing = Option.getOrNull(local);
        if (record.definition === null) {
          // Unshared elsewhere: the copy here stays, as a local bot.
          if (existing?.library != null) yield* bots.setLibraryLink(existing.id, null);
          continue;
        }
        if (existing !== null && existing.library == null) {
          refused.push({
            libraryBotId: record.id,
            message: `A bot named ${record.id} already exists on this computer, so the shared one was not added.`,
          });
          continue;
        }
        if (existing?.library != null && existing.library.revision >= record.revision) continue;
        const localProject =
          record.libraryProjectId === null
            ? null
            : yield* projects.toLocal(record.libraryProjectId);
        const modelOverride = existing?.library?.modelOverride ?? null;
        const definition = withProject(record.definition, localProject);
        const written = yield* bots
          .writeFromLibrary(
            modelOverride === null ? definition : { ...definition, modelSelection: modelOverride },
            {
              libraryBotId: record.id,
              revision: record.revision,
              libraryProjectId: record.libraryProjectId,
              syncedAt: yield* nowIso,
              modelOverride,
            },
            USER_CALLER,
          )
          .pipe(
            Effect.as(true),
            Effect.catch((error) =>
              Effect.sync(() => {
                refused.push({ libraryBotId: record.id, message: error.message });
                return false;
              }),
            ),
          );
        if (written) pulled += 1;
      }
      if (page.cursor !== cursor) {
        cursor = page.cursor;
        yield* storage(store.setLibraryCursor(cursor));
      }
      if (page.records.length === 0) break;
    }
    return { pulled, refused } satisfies BotSyncResult;
  });
  const sync = Effect.fn("BotSharing.sync")(function* () {
    return yield* syncLock.withPermit(syncNow);
  });

  const remoteTargets = client.targets.pipe(
    Effect.map((statuses) =>
      statuses.filter((status) => status.environmentId !== client.environmentId),
    ),
    Effect.orElseSucceed(() => []),
  );

  const targets = Effect.fn("BotSharing.targets")(function* (
    botId: string,
    projectId: ProjectId | null = null,
  ) {
    const bot = yield* bots.get(botId);
    // Other computers find a run's project through the Library, so it must be there.
    const runProject = projectId ?? definitionProject(bot);
    const unshared =
      runProject !== null && (yield* projects.toLibrary(runProject)) === null
        ? "Add this project to the Library to run it on other computers."
        : null;
    const library = yield* client.availability();
    const own = yield* readiness(bot);
    const here: BotTargetReadiness = {
      environmentId: client.environmentId,
      label: yield* client.label,
      isThisComputer: true,
      online: true,
      ready: own.length === 0,
      freeSlots: yield* freeSlots,
      reasons: own,
    };
    if (library !== "available") return { library, targets: [here] } satisfies BotTargetsResult;
    const now = yield* nowMs;
    const others = (yield* remoteTargets).map((status): BotTargetReadiness => {
      const online = now - Date.parse(status.reportedAt) <= BOT_LIBRARY_STATUS_FRESH_MS;
      const entry =
        bot.library == null
          ? undefined
          : status.report.bots.find(
              (candidate) => candidate.libraryBotId === bot.library!.libraryBotId,
            );
      const reasons = !online
        ? ["It is offline."]
        : unshared !== null
          ? [unshared]
          : !status.report.acceptRemote
            ? ["Remote runs are off on that computer."]
            : bot.library == null
              ? ["Share this bot to run it on other computers."]
              : entry === undefined
                ? ["It does not have this bot yet."]
                : entry.ready
                  ? []
                  : [...entry.reasons];
      return {
        environmentId: status.environmentId,
        label: status.report.label,
        isThisComputer: false,
        online,
        ready: reasons.length === 0,
        freeSlots: status.report.freeSlots,
        reasons,
      };
    });
    return { library, targets: [here, ...others] } satisfies BotTargetsResult;
  });

  const resolveTarget = Effect.fnUntraced(function* (
    bot: BotDefinition,
    target: BotTarget,
    projectId: ProjectId | null = null,
  ) {
    if (target.type === "here") return null;
    if (target.type === "environment") {
      if (target.environmentId === client.environmentId) return null;
      const status = (yield* remoteTargets).find(
        (candidate) => candidate.environmentId === target.environmentId,
      );
      return {
        environmentId: target.environmentId,
        label: status?.report.label ?? "Another computer",
      } satisfies BotRunComputer;
    }
    const ready = (yield* targets(bot.id, projectId)).targets.filter(
      (candidate) => candidate.ready,
    );
    // Most free slots wins; this computer is listed first, so it keeps a tie.
    const best = ready.reduce<BotTargetReadiness | null>(
      (winner, candidate) =>
        winner === null || candidate.freeSlots > winner.freeSlots ? candidate : winner,
      null,
    );
    if (best === null) return yield* fail("invalid", `No computer is ready to run ${bot.name}.`);
    return best.isThisComputer ? null : { environmentId: best.environmentId, label: best.label };
  });

  const submit: BotsAnywhereHooks["submit"] = Effect.fnUntraced(function* (run, bot, untrusted) {
    const link = bot.library;
    const ranOn = run.ranOn;
    if (link == null || ranOn == null)
      return yield* fail("invalid", `Share ${bot.name} to run it on another computer.`);
    const libraryProjectId =
      run.projectId === null ? null : yield* projects.toLibrary(run.projectId);
    if (run.projectId !== null && libraryProjectId === null)
      return yield* fail("launch", "Add this project to the Library to run it on other computers.");
    yield* client
      .submit({
        targetEnvironmentId: ranOn.environmentId,
        request: {
          requestId: run.id,
          threadId: run.threadId,
          libraryBotId: link.libraryBotId,
          revision: link.revision,
          inputs: run.inputs,
          requesterLabel: yield* client.label,
          libraryProjectId,
          ...(untrusted === undefined ? {} : { untrusted }),
        },
      })
      .pipe(
        Effect.catch((error) =>
          error.reason !== "io"
            ? Effect.fail(fail("launch", error.message))
            : // The Library may have queued the run anyway. Withdrawing it makes the failure true.
              // When the target already took it, or the cancel fails too, the run stays queued until
              // the target's report or its deadline settles it.
              client.cancel(run.id).pipe(
                Effect.matchEffect({
                  onSuccess: (withdrawn) =>
                    withdrawn
                      ? Effect.fail(fail("launch", error.message))
                      : Effect.logWarning("The Library had already handed a bot run on", {
                          runId: run.id,
                        }),
                  onFailure: () =>
                    Effect.logWarning("Could not tell whether the Library took a bot run", {
                      runId: run.id,
                    }),
                }),
              ),
        ),
      );
  });

  const vaultBindings = Effect.fn("BotSharing.vaultBindings")(function* (botId: string) {
    const bot = yield* bots.get(botId);
    const bound = yield* storage(store.vaultBindings(bot.id));
    const bindings: Array<BotVaultBinding> = [];
    for (const slot of bot.vaultSlots ?? []) {
      const itemId = bound.get(slot.name) ?? null;
      const item = itemId === null ? null : yield* vault.describe(itemId);
      bindings.push({ slot: slot.name, itemId, itemLabel: item?.label ?? null });
    }
    return bindings;
  });

  const bindVaultSlot = Effect.fn("BotSharing.bindVaultSlot")(function* (
    botId: string,
    slot: string,
    itemId: string | null,
  ) {
    const bot = yield* bots.get(botId);
    if (!(bot.vaultSlots ?? []).some((candidate) => candidate.name === slot))
      return yield* fail("invalid", `${bot.name} has no Vault slot named ${slot}.`);
    if (itemId !== null && (yield* vault.describe(itemId)) === null)
      return yield* fail("invalid", "That Vault item cannot be read on this computer.");
    yield* storage(store.bindVaultSlot(bot.id, slot, itemId));
    if (bot.library != null) yield* reportStatus.pipe(Effect.ignore({ log: true }));
    return yield* vaultBindings(bot.id);
  });

  const vaultLines = Effect.fnUntraced(function* (bot: BotDefinition) {
    const bound = yield* storage(store.vaultBindings(bot.id));
    const lines: Array<string> = [];
    for (const slot of bot.vaultSlots ?? []) {
      const itemId = bound.get(slot.name);
      const item = itemId === undefined ? null : yield* vault.describe(itemId);
      if (itemId === undefined || item === null)
        return yield* fail(
          "invalid",
          `Bind the Vault slot "${slot.label}" on this computer before running ${bot.name}.`,
        );
      lines.push(
        vaultPromptLink(
          { kind: "reference", environmentId: item.environmentId, id: itemId },
          slot.label,
        ),
      );
    }
    return lines;
  });

  const remoteSettings = Effect.fn("BotSharing.remoteSettings")(function* () {
    return yield* storage(store.remoteSettings());
  });

  /**
   * Whether to read requests from the Library: while this computer takes runs, and after it stops,
   * until the runs it already took end, so their requesters can still cancel them.
   */
  const readsRequests = Effect.fn("BotSharing.readsRequests")(function* () {
    if ((yield* storage(store.remoteSettings())).acceptRemote) return true;
    const unfinished = yield* storage(store.listUnfinishedRuns());
    return unfinished.some((run) => run.requestedBy != null);
  });

  const setRemoteSettings = Effect.fn("BotSharing.setRemoteSettings")(function* (
    settings: BotRemoteSettings,
  ) {
    yield* storage(store.setRemoteSettings(settings));
    if ((yield* client.availability()) === "available")
      yield* reportStatus.pipe(Effect.ignore({ log: true }));
    return settings;
  });

  /** Runs, refuses or cancels one delivered request on this computer. */
  const handleDelivery = Effect.fn("BotSharing.handleDelivery")(function* (
    delivery: BotLibraryDelivery,
  ) {
    const ack = (refused: string | null) =>
      client.ack({ messageId: delivery.messageId, refused }).pipe(Effect.mapError(fromLibrary));
    const message = delivery.message;
    if (message._tag === "cancel") {
      const run = yield* storage(store.getRunForRequest(message.requestId));
      if (run !== null && !isTerminalBotRunStatus(run.status))
        yield* bots.cancel(run.id).pipe(Effect.ignore({ log: true }));
      // A run cancelled before this computer started it will never start, so say it ended here.
      if (run === null)
        yield* client
          .postResult({
            requestId: message.requestId,
            seq: 2,
            update: {
              _tag: "terminal",
              label: yield* client.label,
              status: "cancelled",
              startedAt: null,
              finishedAt: yield* nowIso,
              result: null,
              resultTruncated: false,
              error: null,
              verdict: null,
              usage: null,
              modelSelection: null,
            },
          })
          .pipe(Effect.ignore({ log: true }));
      return yield* ack(null);
    }
    const request = message.request;
    // A redelivery after a lost ack finds the run it already started.
    if ((yield* storage(store.getRunForRequest(request.requestId))) !== null)
      return yield* ack(null);
    const label = yield* client.label;
    const settings = yield* storage(store.remoteSettings());
    if (!settings.acceptRemote)
      return yield* ack(`${label} does not run bots for other computers.`);
    const findShared = bots.get(request.libraryBotId).pipe(
      Effect.option,
      Effect.map((found) =>
        Option.isSome(found) && found.value.library != null ? found.value : null,
      ),
    );
    let bot = yield* findShared;
    if (bot === null || bot.library!.revision < request.revision) {
      yield* sync().pipe(Effect.ignore({ log: true }));
      bot = yield* findShared;
    }
    if (bot === null) return yield* ack(`${label} does not have this bot.`);
    // The requester recorded the run as the revision it sent, so a later edit must not run in its place.
    if (bot.library!.revision > request.revision)
      return yield* ack(`${bot.name} changed after this run was sent. Run it again.`);
    if (bot.archivedAt !== null) return yield* ack(`${bot.name} is archived on ${label}.`);
    if (outranks(bot.runtimeMode, settings.runtimeModeCeiling))
      return yield* ack(
        `${label} runs other computers' bots in ${settings.runtimeModeCeiling} mode at most, and ${bot.name} runs in ${bot.runtimeMode} mode.`,
      );
    const projectId =
      request.libraryProjectId == null ? null : yield* projects.toLocal(request.libraryProjectId);
    if (request.libraryProjectId != null && projectId === null)
      return yield* ack(`${label} has no copy of this run's project.`);
    // A run that cannot start is recorded under the request's id and reported back as failed.
    return yield* bots
      .startRunWith(
        bot,
        {
          botId: bot.id,
          inputs: request.inputs,
          ...(projectId === null ? {} : { projectId }),
        },
        {
          actor: "agent",
          threadId: null,
          projectId,
          runtimeMode: settings.runtimeModeCeiling,
        },
        {
          remote: {
            runId: request.requestId,
            requestedBy: {
              environmentId: delivery.fromEnvironmentId,
              label: request.requesterLabel,
            },
          },
          ...(request.untrusted === undefined ? {} : { untrusted: request.untrusted }),
        },
      )
      .pipe(
        Effect.matchEffect({
          onFailure: (error) => ack(error.message),
          onSuccess: () => ack(null),
        }),
      );
  });

  /** Sends the requester whatever it has not heard about a run this computer ran for it. */
  const reportRun = Effect.fnUntraced(function* (run: BotRun, reported: number) {
    const label = yield* client.label;
    const sent = (seq: 1 | 2) => storage(store.markRemoteReported(run.id, seq));
    const post = (seq: 1 | 2, update: Parameters<typeof client.postResult>[0]["update"]) =>
      client.postResult({ requestId: run.id, seq, update }).pipe(
        // The Library no longer knows the request, so there is no one left to tell.
        Effect.catchIf(
          (error) => error.reason === "not_found",
          () => Effect.void,
        ),
        Effect.mapError(fromLibrary),
        Effect.andThen(sent(seq)),
      );
    if (run.status === "running" && reported < 1)
      yield* post(1, { _tag: "started", label, startedAt: run.startedAt ?? run.createdAt });
    if (isTerminalBotRunStatus(run.status) && reported < 2)
      yield* post(2, {
        _tag: "terminal",
        label,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? (yield* nowIso),
        result: run.result,
        resultTruncated: run.resultTruncated,
        error: run.error,
        verdict: run.verdict ?? null,
        usage: run.usage ?? null,
        modelSelection: run.modelSelection ?? null,
      });
  });

  const reportRuns = Effect.gen(function* () {
    for (const { run, reported } of yield* storage(store.listUnreportedRemoteRuns()))
      yield* reportRun(run, reported);
  });

  const applyResults = Effect.fnUntraced(function* (waitMs: number) {
    const results = yield* client.nextResults(waitMs).pipe(Effect.mapError(fromLibrary));
    for (const result of results) {
      yield* bots.applyRemoteUpdate(result.requestId, result.update);
      yield* client
        .ackResult({ requestId: result.requestId, seq: result.seq })
        .pipe(Effect.mapError(fromLibrary));
    }
    return results.length;
  });

  /** Ends remote runs whose computer went quiet well past their timeout. */
  const sweepDeadlines = Effect.gen(function* () {
    const now = yield* nowMs;
    for (const run of yield* storage(store.listOpenRemoteRuns())) {
      const bot = Option.getOrNull(yield* bots.get(run.botId).pipe(Effect.option));
      const timeoutMs = (bot?.timeoutMinutes ?? FALLBACK_TIMEOUT_MINUTES) * 60_000;
      const deadline =
        run.startedAt === null
          ? Date.parse(run.createdAt) + PICKUP_GRACE_MS + timeoutMs + REPORT_GRACE_MS
          : Date.parse(run.startedAt) + timeoutMs + REPORT_GRACE_MS;
      if (now <= deadline) continue;
      const label = run.ranOn?.label ?? "The other computer";
      yield* bots.applyRemoteUpdate(run.id, {
        _tag: "terminal",
        label,
        status: "timed_out",
        startedAt: run.startedAt,
        finishedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
        result: null,
        resultTruncated: false,
        error: `${label} did not report back.`,
        verdict: null,
        usage: null,
        modelSelection: null,
      });
    }
  });

  const hooks: BotsAnywhereHooks = {
    publish: publishEdit,
    resolveTarget,
    submit,
    cancel: (run) => client.cancel(run.id).pipe(Effect.ignore({ log: true })),
    vaultLines,
  };

  /** Reports each run this computer ran for another one as soon as it starts or ends. */
  const onChange = (change: BotsChange) =>
    change._tag === "run" && change.run.requestedBy != null ? reportRuns : Effect.void;

  return {
    share,
    unshare,
    sync,
    targets,
    vaultBindings,
    bindVaultSlot,
    remoteSettings,
    setRemoteSettings,
    hooks,
    reportStatus,
    readsRequests,
    handleDelivery,
    reportRuns,
    applyResults,
    sweepDeadlines,
    onChange,
    resolveTarget,
  };
});

export type BotSharingShape = Effect.Success<ReturnType<typeof makeSharing>>;

export class BotSharing extends Context.Service<
  BotSharing,
  Pick<
    BotSharingShape,
    | "share"
    | "unshare"
    | "sync"
    | "targets"
    | "vaultBindings"
    | "bindVaultSlot"
    | "remoteSettings"
    | "setRemoteSettings"
  >
>()("t3/fork/bots/BotSharing") {}

/** Each loop waits out a failure, so a Library that is down is asked again later. */
const keepGoing = <E, R>(label: string, effect: Effect.Effect<unknown, E, R>) =>
  forkParked(
    effect.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning(label, { cause }).pipe(Effect.andThen(Effect.sleep(IDLE_POLL))),
      ),
      Effect.forever,
    ),
  );

const make = Effect.gen(function* () {
  const bots = yield* BotsService;
  const client = yield* BotLibraryClient;
  const workspace = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const references = yield* VaultReferences.VaultReferences;
  const settings = yield* ServerSettings.ServerSettingsService;
  const receipts = workspace.receipts.pipe(Effect.orElseSucceed(() => []));
  const sharing = yield* makeSharing({
    bots,
    client,
    projects: {
      toLibrary: (projectId) =>
        receipts.pipe(
          Effect.map(
            (all) =>
              all.find(
                (receipt) =>
                  receipt.rootLocalProjectId === projectId ||
                  receipt.copy.repositories.some(
                    (repository) => repository.localProjectId === projectId,
                  ),
              )?.project.id ?? null,
          ),
        ),
      toLocal: (libraryProjectId) =>
        receipts.pipe(
          Effect.map((all) => {
            const receipt = all.find((candidate) => candidate.project.id === libraryProjectId);
            return (
              receipt?.rootLocalProjectId ?? receipt?.copy.repositories[0]?.localProjectId ?? null
            );
          }),
        ),
    },
    vault: {
      describe: (itemId) =>
        references.describe(itemId).pipe(
          Effect.map((reference) =>
            reference === null || reference.item.state !== "active"
              ? null
              : { environmentId: reference.environmentId, label: reference.item.label },
          ),
          Effect.orElseSucceed(() => null),
        ),
    },
    modelEnabled: (model) =>
      settings.getSettings.pipe(
        Effect.map((current) => isModelSelectionProviderEnabled(current, model)),
        Effect.orElseSucceed(() => false),
      ),
  });
  yield* bots.setAnywhereHooks(sharing.hooks);

  const available = client.availability().pipe(Effect.map((value) => value === "available"));
  const whenAvailable = (effect: Effect.Effect<unknown, BotsError>) =>
    available.pipe(Effect.flatMap((ok) => (ok ? effect : Effect.void)));

  yield* keepGoing(
    "Syncing shared bots failed",
    bots.whenRecovered.pipe(
      Effect.andThen(whenAvailable(sharing.sync())),
      Effect.andThen(Effect.sleep(SYNC_INTERVAL)),
    ),
  );
  yield* keepGoing(
    "Reporting bot status to the Library failed",
    whenAvailable(sharing.reportStatus).pipe(Effect.andThen(Effect.sleep(STATUS_INTERVAL))),
  );
  yield* keepGoing(
    "Reading remote bot runs from the Library failed",
    Effect.gen(function* () {
      const reading = (yield* available) && (yield* sharing.readsRequests());
      if (!reading) return yield* Effect.sleep(IDLE_POLL);
      const deliveries = yield* client.nextRequests(LONG_POLL_MS);
      for (const delivery of deliveries) yield* sharing.handleDelivery(delivery);
    }),
  );
  // Waits for results only while a run this computer asked for is still open.
  const store = yield* makeBotsStore;
  yield* keepGoing(
    "Reading bot results from the Library failed",
    Effect.gen(function* () {
      const open = yield* store.listOpenRemoteRuns();
      if (open.length === 0 || !(yield* available)) return yield* Effect.sleep(IDLE_POLL);
      yield* sharing.applyResults(LONG_POLL_MS);
    }),
  );
  yield* keepGoing(
    "Reporting remote bot runs failed",
    sharing.reportRuns.pipe(
      Effect.andThen(sharing.sweepDeadlines),
      Effect.andThen(Effect.sleep(REPORT_SWEEP_INTERVAL)),
    ),
  );
  yield* forkParked(
    bots.changes.pipe(
      Stream.runForEach((change) => sharing.onChange(change).pipe(Effect.ignore({ log: true }))),
    ),
  );

  return BotSharing.of(sharing);
});

export const layer = Layer.effect(BotSharing, make);
