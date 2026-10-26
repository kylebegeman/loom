import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, type ModelSelection } from "@t3tools/contracts";
import {
  BotLibraryError,
  botRunThreadId,
  type BotLibraryStatusReport,
  type BotRemoteRunRequest,
  type VaultCoreStatus,
  type DirectoryListing,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { inProcessClient, type BotLibraryClient } from "./BotLibraryClient.ts";
import { BotLibraryService, layer as libraryLayer } from "./BotLibraryService.ts";
import {
  libraryProjectBlocker,
  libraryProjectFor,
  localProjectFor,
  makeSharing,
  reportedLibraryProjects,
} from "./BotSharing.ts";
import { USER_CALLER, versionInput } from "./BotsService.ts";
import { model, projectId, reviewer, withHarness, type Harness } from "./testing/BotsHarness.ts";
import { copyFor } from "../project-library/Library.testkit.ts";
import type { WorkspaceReceipt } from "../project-library/LibraryWorkspaceStore.ts";

const laptop = EnvironmentId.make("env-laptop");
const studio = EnvironmentId.make("env-studio");
const libraryProject = "library-project-a";
const otherModel: ModelSelection = { ...model, model: "studio-only" };

const studioReport = (fields: Partial<BotLibraryStatusReport> = {}): BotLibraryStatusReport => ({
  label: "Studio",
  acceptRemote: true,
  runtimeModeCeiling: "auto",
  freeSlots: 4,
  bots: [
    { libraryBotId: "reviewer", revision: 1, ready: true, reasons: [], availability: "ready" },
  ],
  projects: [{ libraryProjectId: libraryProject, ready: true, reasons: [], availability: "ready" }],
  ...fields,
});

/**
 * This computer ("Laptop") shares through a real Library store in the same database; the test
 * plays the other computer ("Studio") by calling the store directly.
 */
const setup = (
  harness: Harness,
  wrap: (client: BotLibraryClient["Service"]) => BotLibraryClient["Service"] = (client) => client,
) =>
  Effect.gen(function* () {
    const built = yield* Layer.build(
      libraryLayer.pipe(
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
        ),
      ),
    );
    const library = Context.get(built, BotLibraryService);
    const bots = yield* harness.service;
    const enabled = { models: [model.model] as Array<string> };
    const readiness = {
      provider: [] as Array<{ availability: "blocked" | "unknown"; message: string }>,
      project: [] as Array<{ availability: "blocked" | "unknown"; message: string }>,
      directory: null as DirectoryListing | null,
      vaultState: "ready" as VaultCoreStatus["state"],
      items: new Map<string, { environmentId: typeof laptop; label: string }>(),
    };
    const sharing = yield* makeSharing({
      bots,
      client: wrap(inProcessClient(library, laptop, Effect.succeed("Laptop"))),
      projects: {
        toLibrary: (id) => Effect.succeed(id === projectId ? libraryProject : null),
        toLocal: (id) => Effect.succeed(id === libraryProject ? projectId : null),
        readiness: () => Effect.sync(() => readiness.project),
        libraryProjects: Effect.succeed([libraryProject]),
      },
      vault: {
        describe: (id) => Effect.sync(() => readiness.items.get(id) ?? null),
        status: Effect.sync(() => ({
          backend: "openbao",
          state: readiness.vaultState,
          origin: null,
        })),
      },
      computers: Effect.sync(() => readiness.directory),
      modelReadiness: () => Effect.sync(() => readiness.provider),
      modelEnabled: (selection) => Effect.succeed(enabled.models.includes(selection.model)),
    });
    yield* bots.setAnywhereHooks(sharing.hooks);
    return { library, bots, sharing, enabled, readiness };
  });

const studioPublishes = (
  library: BotLibraryService["Service"],
  fields: Parameters<typeof reviewer>[0] = {},
  expectedRevision: number | null = null,
) =>
  library.publish(studio, {
    definition: reviewer({ scopeProjectId: ProjectId.make(libraryProject), ...fields }),
    libraryProjectId: libraryProject,
    expectedRevision,
    label: "Studio",
  });

const studioRequest = (requestId: string): BotRemoteRunRequest => ({
  requestId,
  threadId: botRunThreadId(requestId),
  libraryBotId: "reviewer",
  revision: 1,
  inputs: { file: "a.ts" },
  requesterLabel: "Studio",
  libraryProjectId: libraryProject,
});

describe("BotSharing", () => {
  it.effect(
    "reports provider authentication and failed tool checks instead of configured readiness",
    () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const { bots, sharing, readiness } = yield* setup(harness);
          yield* bots.save(reviewer(), USER_CALLER);
          readiness.provider = [
            { availability: "blocked", message: "Its provider is not signed in on this computer." },
          ];
          readiness.project = [
            { availability: "unknown", message: "The required Node.js tool could not be checked." },
          ];
          const [target] = (yield* sharing.targets("reviewer", projectId)).targets;
          expect(target).toMatchObject({ ready: false, availability: "blocked" });
          expect(target?.reasons).toEqual([
            readiness.provider[0]!.message,
            readiness.project[0]!.message,
          ]);
          readiness.provider = [];
          expect((yield* sharing.targets("reviewer", projectId)).targets[0]).toMatchObject({
            ready: false,
            availability: "unknown",
          });
        }),
      ),
  );

  it.effect("checks the live Vault backend and bound item before declaring a target ready", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, sharing, readiness } = yield* setup(harness);
        yield* bots.save(
          reviewer({ vaultSlots: [{ name: "github", label: "GitHub", action: "use" }] }),
          USER_CALLER,
        );
        readiness.items.set("item", { environmentId: laptop, label: "Local GitHub" });
        yield* sharing.bindVaultSlot("reviewer", "github", "item");
        expect((yield* sharing.targets("reviewer")).targets[0]?.ready).toBe(true);
        readiness.vaultState = "locked";
        expect((yield* sharing.targets("reviewer")).targets[0]).toMatchObject({
          ready: false,
          availability: "blocked",
          reasons: ["The Vault backend is locked on this computer."],
        });
        readiness.vaultState = "unavailable";
        expect((yield* sharing.targets("reviewer")).targets[0]?.availability).toBe("unknown");
        readiness.vaultState = "ready";
        readiness.items.delete("item");
        expect((yield* sharing.targets("reviewer")).targets[0]).toMatchObject({
          ready: false,
          reasons: ['Its Vault slot "GitHub" is no longer readable on this computer.'],
        });
      }),
    ),
  );

  it.effect("reports busy targets with zero slots and excludes them from Best available", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        const local = yield* bots.run(
          { botId: "reviewer", projectId, inputs: { file: "local.ts" } },
          USER_CALLER,
        );
        yield* harness.nextLaunch;
        yield* library.reportStatus(studio, studioReport({ freeSlots: 0 }));
        const result = yield* sharing.targets("reviewer");
        expect(
          result.targets.map((target) => [target.ready, target.availability, target.freeSlots]),
        ).toEqual([
          [false, "busy", 0],
          [false, "busy", 0],
        ]);
        const refused = yield* sharing
          .resolveTarget(yield* bots.get("reviewer"), { type: "best" }, projectId)
          .pipe(Effect.flip);
        expect(refused.message).toContain("No computer is ready");
        yield* bots.cancel(local.id);
      }),
    ),
  );

  it.effect("reserves unreported outgoing runs against target slots across concurrent starts", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        yield* library.reportStatus(
          studio,
          studioReport({
            freeSlots: 2,
            bots: [
              { libraryBotId: "reviewer", revision: 1, ready: true, reasons: [], freeSlots: 2 },
            ],
          }),
        );
        const attempts = yield* Effect.forEach(
          ["a", "b", "c"],
          (file) =>
            bots
              .run(
                {
                  botId: "reviewer",
                  projectId,
                  inputs: { file },
                  target: { type: "environment", environmentId: studio },
                },
                USER_CALLER,
              )
              .pipe(Effect.result),
          { concurrency: "unbounded" },
        );
        expect(attempts.filter((attempt) => attempt._tag === "Success")).toHaveLength(2);
        expect(attempts.filter((attempt) => attempt._tag === "Failure")).toHaveLength(1);
        expect((yield* sharing.targets("reviewer", projectId)).targets[1]).toMatchObject({
          availability: "busy",
          freeSlots: 0,
        });
        expect(yield* bots.activeRuns).toBe(0);
        expect(harness.launches).toHaveLength(0);
      }),
    ),
  );

  it.effect("does not subtract reservations already included in the target's report", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        const report = studioReport({
          freeSlots: 3,
          bots: [{ libraryBotId: "reviewer", revision: 1, ready: true, reasons: [], freeSlots: 3 }],
        });
        yield* library.reportStatus(studio, report);
        const run = yield* bots.run(
          {
            botId: "reviewer",
            projectId,
            inputs: { file: "a" },
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
        );
        yield* library.reportStatus(studio, {
          ...report,
          freeSlots: 2,
          activeRequestIds: [run.id],
        });
        expect((yield* sharing.targets("reviewer", projectId)).targets[1]?.freeSlots).toBe(2);
        // An older target cannot identify reservations; keeping them is conservative.
        yield* library.reportStatus(studio, { ...report, freeSlots: 2 });
        expect((yield* sharing.targets("reviewer", projectId)).targets[1]?.freeSlots).toBe(1);
      }),
    ),
  );

  it.effect("distinguishes offline reports from unreadable target status", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const fails = { value: false };
        const { library, bots, sharing } = yield* setup(harness, (client) => ({
          ...client,
          targets: Effect.suspend(() =>
            fails.value
              ? Effect.fail(new BotLibraryError({ reason: "io", message: "Unreachable" }))
              : client.targets,
          ),
        }));
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        yield* library.reportStatus(studio, studioReport());
        expect((yield* sharing.targets("reviewer")).targets[1]?.availability).toBe("ready");
        fails.value = true;
        expect((yield* sharing.targets("reviewer")).targets[1]).toMatchObject({
          environmentId: studio,
          online: true,
          ready: false,
          availability: "unknown",
          freeSlots: 0,
        });
        fails.value = false;
        yield* TestClock.adjust("3 minutes");
        expect((yield* sharing.targets("reviewer")).targets[1]).toMatchObject({
          online: false,
          ready: false,
          availability: "offline",
          freeSlots: 0,
        });
      }),
    ),
  );

  it.effect(
    "lists directory computers without inventing bot readiness from directory presence",
    () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const { bots, sharing, readiness, library } = yield* setup(harness);
          yield* bots.save(reviewer(), USER_CALLER);
          yield* sharing.share("reviewer");
          readiness.directory = {
            generatedAt: "1970-01-01T00:00:00.000Z",
            machines: [],
            environments: [
              {
                environmentId: studio,
                label: "Studio",
                supportsExecution: true,
                loomFeatures: [],
                routes: [],
                providers: [],
                serverVersion: "test",
                platform: { os: "darwin", arch: "arm64" },
                sequence: 1,
                reportedAt: "1970-01-01T00:00:00.000Z",
                receivedAt: "1970-01-01T00:00:00.000Z",
                firstSeenAt: "1970-01-01T00:00:00.000Z",
                keyFingerprint: "a".repeat(64),
              },
            ],
          };
          expect((yield* sharing.targets("reviewer")).targets[1]).toMatchObject({
            environmentId: studio,
            online: true,
            ready: false,
            availability: "unknown",
            freeSlots: 0,
          });
          yield* library.reportStatus(studio, studioReport());
          expect((yield* sharing.targets("reviewer")).targets[1]?.ready).toBe(true);
          readiness.directory = {
            ...readiness.directory,
            environments: readiness.directory.environments.map((environment) => ({
              ...environment,
              supportsExecution: false,
            })),
          };
          expect((yield* sharing.targets("reviewer")).targets[1]).toMatchObject({
            ready: false,
            availability: "blocked",
            reasons: ["That computer does not run agents."],
          });
        }),
      ),
  );

  it.effect(
    "checks the selected project's copy and tools for global bots on another computer",
    () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const { library, bots, sharing } = yield* setup(harness);
          yield* bots.save(reviewer(), USER_CALLER);
          yield* sharing.share("reviewer");
          yield* library.reportStatus(
            studio,
            studioReport({
              projects: [
                {
                  libraryProjectId: libraryProject,
                  ready: false,
                  availability: "blocked",
                  reasons: ["The required Swift tool is missing on this computer."],
                },
              ],
            }),
          );
          expect((yield* sharing.targets("reviewer", projectId)).targets[1]).toMatchObject({
            ready: false,
            availability: "blocked",
            reasons: ["The required Swift tool is missing on this computer."],
          });
          yield* library.reportStatus(studio, studioReport({ projects: [] }));
          expect((yield* sharing.targets("reviewer", projectId)).targets[1]).toMatchObject({
            ready: false,
            availability: "blocked",
            reasons: ["This computer has no ready copy of this run's project."],
          });
          const { projects: _projects, ...legacy } = studioReport();
          yield* library.reportStatus(studio, legacy);
          expect((yield* sharing.targets("reviewer", projectId)).targets[1]).toMatchObject({
            ready: false,
            availability: "unknown",
            reasons: ["It has not reported readiness for this run's project."],
          });
        }),
      ),
  );

  it.effect("shares a project bot under its Library project and refuses one outside it", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer({ scopeProjectId: projectId }), USER_CALLER);
        const shared = yield* sharing.share("reviewer");
        expect(shared.library).toMatchObject({ revision: 1, libraryProjectId: libraryProject });
        const [record] = (yield* library.list(0)).records;
        expect(record?.definition?.scopeProjectId).toBe(libraryProject);

        yield* bots.save(
          reviewer({ id: "elsewhere", scopeProjectId: ProjectId.make("project-b") }),
          USER_CALLER,
        );
        const refused = yield* sharing.share("elsewhere").pipe(Effect.flip);
        expect(refused.message).toContain("Add this bot's project to the Library first");
      }),
    ),
  );

  it.effect("pulls shared bots into this computer's copy of their project", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* studioPublishes(library);
        expect(yield* sharing.sync()).toEqual({ pulled: 1, refused: [] });
        const pulled = yield* bots.get("reviewer");
        expect(pulled.scopeProjectId).toBe(projectId);
        expect(pulled.library?.revision).toBe(1);

        yield* studioPublishes(library, { description: "Sharper." }, 1);
        expect((yield* sharing.sync()).pulled).toBe(1);
        expect((yield* bots.get("reviewer")).description).toBe("Sharper.");
        expect((yield* sharing.sync()).pulled).toBe(0);

        yield* library.unpublish(studio, "reviewer", "Studio");
        yield* sharing.sync();
        const kept = yield* bots.get("reviewer");
        expect(kept.library ?? null).toBeNull();
        expect(kept.description).toBe("Sharper.");
      }),
    ),
  );

  it.effect("does not replace a local bot that happens to share an id", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer({ description: "Mine." }), USER_CALLER);
        yield* studioPublishes(library);
        const result = yield* sharing.sync();
        expect(result.pulled).toBe(0);
        expect(result.refused.map((entry) => entry.libraryBotId)).toEqual(["reviewer"]);
        expect((yield* bots.get("reviewer")).description).toBe("Mine.");
      }),
    ),
  );

  it.effect("keeps a model this computer picked for itself out of the shared bot", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* library.publish(studio, {
          definition: { ...reviewer(), modelSelection: otherModel },
          libraryProjectId: null,
          expectedRevision: null,
          label: "Studio",
        });
        yield* sharing.sync();
        const pulled = yield* bots.get("reviewer");
        const saved = yield* bots.save(
          { ...versionInput(pulled), modelSelection: model, description: "Mine now." },
          USER_CALLER,
        );
        expect(saved.library?.modelOverride).toEqual(model);
        const [record] = (yield* library.list(0)).records;
        expect(record?.definition?.modelSelection).toEqual(otherModel);
        expect(record?.definition?.description).toBe("Mine now.");

        yield* library.publish(studio, {
          definition: { ...reviewer(), modelSelection: otherModel, description: "Studio." },
          libraryProjectId: null,
          expectedRevision: 2,
          label: "Studio",
        });
        yield* sharing.sync();
        expect(yield* bots.get("reviewer")).toMatchObject({
          description: "Studio.",
          modelSelection: model,
        });
      }),
    ),
  );

  it.effect("runs another computer's request under its ceiling and reports back once", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* studioPublishes(library);
        yield* sharing.sync();
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));

        const deliver = (requestId: string) =>
          library
            .submit(studio, { targetEnvironmentId: laptop, request: studioRequest(requestId) })
            .pipe(
              Effect.andThen(library.nextRequests(laptop, 0)),
              Effect.flatMap(Effect.forEach((delivery) => sharing.handleDelivery(delivery))),
            );

        // Remote runs are off by default.
        yield* deliver("closed");
        const [refusal] = yield* library.nextResults(studio, 0);
        expect(refusal?.update).toMatchObject({
          status: "failed",
          error: "Laptop does not run bots for other computers.",
        });

        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        yield* deliver("open");
        const launch = yield* harness.nextLaunch;
        expect(launch.threadId).toBe("bot-run-open");
        const run = yield* bots.getRun("open");
        expect(run.requestedBy).toEqual({ environmentId: studio, label: "Studio" });
        expect(run.projectId).toBe(projectId);
        yield* sharing.reportStatus;
        const ownReport = (yield* library.targets).find(
          (target) => target.environmentId === laptop,
        );
        expect(ownReport?.report.activeRequestIds).toEqual(["open"]);
        expect(ownReport?.report.bots[0]?.freeSlots).toBe(0);

        yield* sharing.reportRuns;
        yield* harness.end(launch.threadId!, { status: "completed", reply: "Clean." });
        yield* bots.awaitRun("open", 60_000);
        yield* sharing.reportRuns;
        yield* sharing.reportRuns;
        const results = (yield* library.nextResults(studio, 0)).filter(
          (result) => result.requestId === "open",
        );
        expect(results.map((result) => result.seq)).toEqual([1, 2]);
        expect(results[1]?.update).toMatchObject({ status: "completed", result: "Clean." });
      }),
    ),
  );

  it.effect("refuses a request sent before the bot changed instead of running the edit", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, sharing } = yield* setup(harness);
        yield* studioPublishes(library);
        yield* studioPublishes(library, { description: "Edited." }, 1);
        yield* sharing.sync();
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        yield* library.submit(studio, {
          targetEnvironmentId: laptop,
          request: studioRequest("stale"),
        });
        for (const delivery of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(delivery);

        const [refusal] = yield* library.nextResults(studio, 0);
        expect(refusal?.update).toMatchObject({
          status: "failed",
          error: "Reviewer changed after this run was sent. Run it again.",
        });
        expect(harness.launches).toHaveLength(0);
      }),
    ),
  );

  it.effect("refuses a request for a revision this computer cannot get", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, sharing } = yield* setup(harness);
        yield* studioPublishes(library);
        yield* sharing.sync();
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        yield* library.submit(studio, {
          targetEnvironmentId: laptop,
          request: { ...studioRequest("ahead"), revision: 2 },
        });
        for (const delivery of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(delivery);

        const [refusal] = yield* library.nextResults(studio, 0);
        expect(refusal?.update).toMatchObject({
          status: "failed",
          error: "Laptop could not get the version of Reviewer this run was sent with.",
        });
        expect(harness.launches).toHaveLength(0);
      }),
    ),
  );

  it.effect("refuses a request that needs a broader mode than this computer allows", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, sharing } = yield* setup(harness);
        yield* studioPublishes(library, { runtimeMode: "full-access" });
        yield* sharing.sync();
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        // A stale report must not bypass the target's own ceiling check.
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));
        yield* library.submit(studio, {
          targetEnvironmentId: laptop,
          request: studioRequest("wide"),
        });
        for (const delivery of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(delivery);
        const [result] = yield* library.nextResults(studio, 0);
        expect(result?.update).toMatchObject({ status: "failed" });
        expect(harness.launches).toEqual([]);
      }),
    ),
  );

  it.effect("sends a run to another computer and applies what it reports", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        yield* library.reportStatus(studio, studioReport());

        const run = yield* bots.run(
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
        );
        expect(run).toMatchObject({ status: "queued", ranOn: { environmentId: studio } });
        expect(harness.launches).toEqual([]);

        const [delivery] = yield* library.nextRequests(studio, 0);
        expect(delivery?.message).toMatchObject({
          _tag: "run",
          request: { requestId: run.id, libraryProjectId: libraryProject },
        });
        yield* library.ack(studio, { messageId: delivery!.messageId, refused: null });
        yield* library.postResult(studio, {
          requestId: run.id,
          seq: 2,
          update: {
            _tag: "terminal",
            label: "Studio",
            status: "completed",
            startedAt: "1970-01-01T00:00:01.000Z",
            finishedAt: "1970-01-01T00:00:02.000Z",
            result: "Done there.",
            resultTruncated: false,
            error: null,
            verdict: null,
            usage: null,
            modelSelection: null,
          },
        });
        expect(yield* sharing.applyResults(0)).toBe(1);
        expect(yield* bots.getRun(run.id)).toMatchObject({
          status: "completed",
          result: "Done there.",
        });
      }),
    ),
  );

  it.effect("frames untrusted inputs on the computer that runs them", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        yield* library.reportStatus(studio, studioReport());
        const untrusted = { names: ["file"], origin: "an earlier step of this run's pipeline" };

        const sent = yield* bots.startRunWith(
          yield* bots.get("reviewer"),
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
          { untrusted },
        );
        const [delivery] = yield* library.nextRequests(studio, 0);
        expect(delivery?.message).toMatchObject({
          _tag: "run",
          request: { requestId: sent.id, untrusted },
        });

        // Here as the target: the request's untrusted input reaches the prompt framed.
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));
        yield* library.submit(studio, {
          targetEnvironmentId: laptop,
          request: { ...studioRequest("framed"), untrusted },
        });
        for (const received of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(received);
        const launch = yield* harness.nextLaunch;
        expect(launch.initialMessage?.text).toMatch(/<event-data-\w+>a\.ts<\/event-data-\w+>/);
        expect(launch.initialMessage?.text).toContain(untrusted.origin);
      }),
    ),
  );

  it.effect("tells the requester a run it cancelled before this computer started it ended", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const postFails = { value: true };
        const { library, sharing } = yield* setup(harness, (client) => ({
          ...client,
          postResult: (input) =>
            postFails.value
              ? Effect.fail(
                  new BotLibraryError({ reason: "io", message: "The Library timed out." }),
                )
              : client.postResult(input),
        }));
        yield* studioPublishes(library);
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));
        yield* library.submit(studio, {
          targetEnvironmentId: laptop,
          request: studioRequest("unstarted"),
        });
        // Picked up, then lost before this computer started it.
        yield* library.nextRequests(laptop, 0);

        yield* library.cancel(studio, "unstarted");
        const [cancel] = yield* library.nextRequests(laptop, 0);
        // The ending did not reach the Library, so the cancel stays unacked to come back.
        yield* sharing.handleDelivery(cancel!).pipe(Effect.flip);
        postFails.value = false;
        yield* sharing.handleDelivery(cancel!);
        const [result] = yield* library.nextResults(studio, 0);
        expect(result?.update).toMatchObject({ _tag: "terminal", status: "cancelled" });
      }),
    ),
  );

  it.effect("withdraws a run whose submit went unanswered, or keeps waiting on it", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const lost = new BotLibraryError({ reason: "io", message: "The Library timed out." });
        const cancelFails = { value: false };
        const { library, bots, sharing } = yield* setup(harness, (client) => ({
          ...client,
          // The Library takes the run, but its answer never arrives.
          submit: (request) => client.submit(request).pipe(Effect.andThen(Effect.fail(lost))),
          cancel: (requestId) => (cancelFails.value ? Effect.fail(lost) : client.cancel(requestId)),
        }));
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        yield* library.reportStatus(studio, studioReport());
        const runThere = bots.startRunWith(
          yield* bots.get("reviewer"),
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
          {},
        );

        const withdrawn = yield* runThere;
        expect(withdrawn).toMatchObject({ status: "failed", error: lost.message });
        expect(yield* library.nextRequests(studio, 0)).toEqual([]);

        cancelFails.value = true;
        const waiting = yield* runThere;
        expect(waiting.status).toBe("queued");
        const [delivery] = yield* library.nextRequests(studio, 0);
        expect(delivery?.messageId).toBe(waiting.id);
      }),
    ),
  );

  it.effect("ends a run the Library never took when it is cancelled", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const lost = new BotLibraryError({ reason: "io", message: "The Library timed out." });
        const reachable = { value: false };
        const { library, bots, sharing } = yield* setup(harness, (client) => ({
          ...client,
          submit: () => Effect.fail(lost),
          cancel: (requestId) => (reachable.value ? client.cancel(requestId) : Effect.fail(lost)),
        }));
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        yield* library.reportStatus(studio, studioReport());
        const run = yield* bots.startRunWith(
          yield* bots.get("reviewer"),
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
          {},
        );
        expect(run.status).toBe("queued");

        reachable.value = true;
        expect(yield* bots.cancel(run.id)).toMatchObject({ status: "cancelled" });
        expect(yield* bots.getRun(run.id)).toMatchObject({ status: "cancelled" });
      }),
    ),
  );

  it.effect("still takes cancels for runs it accepted after it stops taking runs", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* studioPublishes(library);
        yield* sharing.sync();
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));
        yield* library.submit(studio, {
          targetEnvironmentId: laptop,
          request: studioRequest("taken"),
        });
        for (const received of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(received);
        yield* harness.nextLaunch;

        yield* sharing.setRemoteSettings({ acceptRemote: false, runtimeModeCeiling: "auto" });
        expect(yield* sharing.readsRequests()).toBe(true);
        yield* library.cancel(studio, "taken");
        for (const received of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(received);
        expect(yield* bots.awaitRun("taken", 60_000)).toMatchObject({ status: "cancelled" });
        expect(yield* sharing.readsRequests()).toBe(false);
      }),
    ),
  );

  it.effect("does not start a queued run from another computer after it stops taking runs", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* studioPublishes(library);
        yield* sharing.sync();
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));
        for (const requestId of ["first", "second"])
          yield* library.submit(studio, {
            targetEnvironmentId: laptop,
            request: studioRequest(requestId),
          });
        for (const received of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(received);
        const launch = yield* harness.nextLaunch;
        expect((yield* bots.getRun("second")).status).toBe("queued");

        yield* sharing.setRemoteSettings({ acceptRemote: false, runtimeModeCeiling: "auto" });
        yield* harness.end(launch.threadId!, { status: "completed", reply: "Clean." });
        expect(yield* bots.awaitRun("second", 60_000)).toMatchObject({
          status: "failed",
          error: "This computer stopped running bots for other computers before the run started.",
        });
        expect(harness.launches).toHaveLength(1);
      }),
    ),
  );

  it.effect("keeps a pinned revision through historical lookup and remote delivery", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const shared = yield* sharing.share("reviewer");
        yield* bots.save(
          { ...versionInput(shared), instructions: "Rewrite {{file}}." },
          USER_CALLER,
        );
        const pinned = yield* bots.definitionAt("reviewer", shared.version);
        expect(pinned.library?.revision).toBe(1);
        yield* library.reportStatus(studio, studioReport());
        const run = yield* bots.startRunWith(
          pinned,
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
          { untrusted: { names: ["file"], origin: "a pipeline" } },
        );
        const [delivery] = yield* library.nextRequests(studio, 0);
        expect(run).toMatchObject({ status: "queued", botVersion: shared.version });
        expect(delivery?.message).toMatchObject({
          _tag: "run",
          request: { revision: 1, untrusted: { names: ["file"], origin: "a pipeline" } },
        });
        // The target has since synced revision 2. It must refuse rather than run it for revision 1.
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
        yield* library.reportStatus(
          laptop,
          studioReport({
            label: "Laptop",
            bots: [{ libraryBotId: "reviewer", revision: 2, ready: true, reasons: [] }],
          }),
        );
        expect(delivery!.message._tag).toBe("run");
        if (delivery!.message._tag !== "run") return;
        yield* library.submit(studio, {
          targetEnvironmentId: laptop,
          request: {
            ...delivery!.message.request,
            requestId: "stale-target",
            threadId: botRunThreadId("stale-target"),
          },
        });
        for (const incoming of yield* library.nextRequests(laptop, 0))
          yield* sharing.handleDelivery(incoming);
        const [refusal] = yield* library.nextResults(studio, 0);
        expect(refusal?.update).toMatchObject({
          status: "failed",
          error: "Reviewer changed after this run was sent. Run it again.",
        });
        expect(harness.launches).toHaveLength(0);
      }),
    ),
  );

  it.effect("refuses a historical definition without a proven shared revision", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        const old = yield* bots.save(reviewer(), USER_CALLER);
        yield* bots.save(reviewer({ instructions: "Rewrite {{file}}." }), USER_CALLER);
        yield* sharing.share("reviewer");
        const pinned = yield* bots.definitionAt("reviewer", old.version);
        yield* library.reportStatus(studio, studioReport());
        const run = yield* bots.startRunWith(
          pinned,
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
          {},
        );
        expect(run).toMatchObject({ status: "failed", botVersion: old.version });
        expect(run.error).toContain("shared revision");
        expect(yield* library.nextRequests(studio, 0)).toEqual([]);
      }),
    ),
  );

  it.effect("refuses a pinned remote run when the target has a different revision", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        const pinned = yield* bots.get("reviewer");
        yield* bots.save({ ...versionInput(pinned), description: "Edited." }, USER_CALLER);
        yield* library.reportStatus(
          studio,
          studioReport({
            bots: [{ libraryBotId: "reviewer", revision: 2, ready: true, reasons: [] }],
          }),
        );

        const run = yield* bots.startRunWith(
          pinned,
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
          {},
        );
        const [delivery] = yield* library.nextRequests(studio, 0);
        expect(delivery).toBeUndefined();
        expect(run).toMatchObject({ status: "failed", botVersion: pinned.version });
        expect(run.error).toContain("requested revision");
      }),
    ),
  );

  it.effect("times out a remote run whose computer stops reporting", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, bots, sharing, enabled } = yield* setup(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* sharing.share("reviewer");
        yield* library.reportStatus(studio, studioReport());
        // This computer cannot run it, so the best computer is Studio.
        enabled.models = [];
        const run = yield* bots.run(
          { botId: "reviewer", inputs: { file: "a.ts" }, projectId, target: { type: "best" } },
          USER_CALLER,
        );
        expect(run.ranOn?.environmentId).toBe(studio);

        yield* sharing.sweepDeadlines;
        expect((yield* bots.getRun(run.id)).status).toBe("queued");
        yield* TestClock.adjust("31 minutes");
        yield* sharing.sweepDeadlines;
        expect(yield* bots.getRun(run.id)).toMatchObject({
          status: "timed_out",
          error: "Studio did not report back.",
        });
      }),
    ),
  );
});

describe("libraryProjectFor", () => {
  const receiptFor = (
    id: string,
    copy: Partial<WorkspaceReceipt["copy"]> = {},
    rootLocalProjectId: ProjectId | null = projectId,
  ): WorkspaceReceipt => {
    const project = {
      id,
      title: id,
      brief: "",
      revision: 1,
      resources: [],
      archived: false,
      createdAt: "2026-10-23T00:00:00.000Z",
      updatedAt: "2026-10-23T00:00:00.000Z",
    };
    return {
      requestId: id,
      fingerprint: id,
      project,
      copy: { ...copyFor(project), id: `copy-${id}`, repositories: [], ...copy },
      rootLocalProjectId,
      rootCheckpointRepository: true,
      legacyThreadIds: [],
      rootIdentity: null,
      releaseRequestId: null,
      releaseReviewToken: null,
      removalPath: null,
      archivePath: null,
      archiveDigest: null,
    };
  };

  it("finds the folder's current owner rather than the archived project it took over from", () => {
    const retired = receiptFor("archived", { registered: false });
    const current = receiptFor("current");
    expect(libraryProjectFor([retired, current], projectId)).toBe("current");
    expect(libraryProjectFor([retired, current], projectId, true)).toBe("current");
    // Old conversations on a retired folder still find the project they ran under.
    expect(libraryProjectFor([retired], projectId)).toBe("archived");
  });

  it("matches a project only through a ready copy when asked, and never a missing project", () => {
    const missing = receiptFor("missing", { state: "missing" });
    expect(libraryProjectFor([missing], projectId)).toBe("missing");
    expect(libraryProjectFor([missing], projectId, true)).toBeNull();
    // A folder with no root project of its own is not the project of a bot without one.
    expect(libraryProjectFor([receiptFor("rootless", {}, null)], null)).toBeNull();
  });

  it("treats a released borrowed folder as no copy at all", () => {
    // Unregistering a borrowed folder leaves its state ready.
    const unregistered = receiptFor("left", { registered: false });
    const released = receiptFor("gone", { state: "released" });
    expect(libraryProjectFor([unregistered], projectId, true)).toBeNull();
    expect(localProjectFor([unregistered, released], "left")).toBeNull();
    expect(libraryProjectBlocker([unregistered], "left")).toBe(
      "This computer has no ready copy of this run's project.",
    );
    expect(reportedLibraryProjects([unregistered, released])).toEqual([]);
  });

  it("reports no archived project and names archiving as the reason a run cannot start", () => {
    const archived = receiptFor("set-aside");
    const setAside = { ...archived, project: { ...archived.project, archived: true } };
    const current = receiptFor("current");
    expect(reportedLibraryProjects([setAside, current])).toEqual(["current"]);
    expect(libraryProjectBlocker([setAside], "set-aside")).toBe(
      "This run's project is archived in the Library. Restore it to run here.",
    );
    expect(libraryProjectBlocker([current], "current")).toBeNull();
  });
});
