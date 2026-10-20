import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, type ModelSelection } from "@t3tools/contracts";
import {
  botRunThreadId,
  type BotLibraryStatusReport,
  type BotRemoteRunRequest,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { inProcessClient } from "./BotLibraryClient.ts";
import { BotLibraryService, layer as libraryLayer } from "./BotLibraryService.ts";
import { makeSharing } from "./BotSharing.ts";
import { USER_CALLER, versionInput } from "./BotsService.ts";
import { model, projectId, reviewer, withHarness, type Harness } from "./testing/BotsHarness.ts";

const laptop = EnvironmentId.make("env-laptop");
const studio = EnvironmentId.make("env-studio");
const libraryProject = "library-project-a";
const otherModel: ModelSelection = { ...model, model: "studio-only" };

const studioReport = (fields: Partial<BotLibraryStatusReport> = {}): BotLibraryStatusReport => ({
  label: "Studio",
  acceptRemote: true,
  runtimeModeCeiling: "auto",
  freeSlots: 4,
  bots: [{ libraryBotId: "reviewer", revision: 1, ready: true, reasons: [] }],
  ...fields,
});

/**
 * This computer ("Laptop") shares through a real Library store in the same database; the test
 * plays the other computer ("Studio") by calling the store directly.
 */
const setup = (harness: Harness) =>
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
    const sharing = yield* makeSharing({
      bots,
      client: inProcessClient(library, laptop, Effect.succeed("Laptop")),
      projects: {
        toLibrary: (id) => Effect.succeed(id === projectId ? libraryProject : null),
        toLocal: (id) => Effect.succeed(id === libraryProject ? projectId : null),
      },
      vault: { describe: () => Effect.succeed(null) },
      modelEnabled: (selection) => Effect.succeed(enabled.models.includes(selection.model)),
    });
    yield* bots.setAnywhereHooks(sharing.hooks);
    return { library, bots, sharing, enabled };
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

  it.effect("refuses a request that needs a broader mode than this computer allows", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { library, sharing } = yield* setup(harness);
        yield* studioPublishes(library, { runtimeMode: "full-access" });
        yield* sharing.sync();
        yield* library.reportStatus(laptop, studioReport({ label: "Laptop" }));
        yield* sharing.setRemoteSettings({ acceptRemote: true, runtimeModeCeiling: "auto" });
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

  it.effect("records a pinned remote run as the revision the other computer runs", () =>
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
        expect(delivery?.message).toMatchObject({ _tag: "run", request: { revision: 2 } });
        expect(run.botVersion).toBe((yield* bots.get("reviewer")).version);
        expect(run.botVersion).not.toBe(pinned.version);
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
