import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type { BotPipelineInput, BotsSaveInput } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import { PullRequestService } from "../../../pullRequest/PullRequestService.ts";
import { GitVcsDriver } from "../../../vcs/GitVcsDriver.ts";
import { WorkspaceEntries } from "../../../workspace/WorkspaceEntries.ts";
import { BotBatches, make as makeBotBatches } from "../BotBatches.ts";
import { BotsService, USER_CALLER, versionInput } from "../BotsService.ts";
import { projectId, reviewer, withHarness, type Harness } from "../testing/BotsHarness.ts";
import { make } from "./BotPipelines.ts";

const WAIT_MS = 60_000;

const verdictBots: ReadonlyArray<BotsSaveInput> = [
  reviewer({ output: "verdict" }),
  reviewer({
    id: "verifier",
    name: "Verifier",
    instructions: "Verify {{file}}.",
    output: "verdict",
  }),
  reviewer({
    id: "fixer",
    name: "Fixer",
    instructions: "Fix {{finding}} in {{file}}.",
    parameters: [
      { name: "file", label: "File", type: "string", required: true },
      { name: "finding", label: "Finding", type: "text", required: true },
    ],
  }),
];

const reviewFixVerify = (maxRounds: number): BotPipelineInput => ({
  id: "review-fix",
  name: "Review and fix",
  description: "",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  steps: [
    { id: "review", botId: "reviewer", inputs: { file: "{{input.file}}" }, onFail: "continue" },
    {
      id: "fix",
      botId: "fixer",
      inputs: { file: "{{input.file}}", finding: "{{item.title}}" },
      forEach: { from: "{{steps.review.findings}}" },
    },
    {
      id: "verify",
      botId: "verifier",
      inputs: { file: "{{input.file}}" },
      onFail: { goTo: "review", maxRounds },
    },
  ],
});

const verdict = (value: "pass" | "fail", titles: ReadonlyArray<string> = []) =>
  JSON.stringify({
    verdict: value,
    summary: value === "pass" ? "All good." : `${titles.length} problems.`,
    findings: titles.map((title) => ({ title, detail: "" })),
  });

/** Ends the next launched run thread with `reply` and returns its first message. */
const endNext = (harness: Harness, reply: string) =>
  Effect.gen(function* () {
    const launch = yield* harness.nextLaunch;
    yield* harness.end(launch.threadId!, { status: "completed", reply });
    return launch.initialMessage?.text ?? "";
  });

const makePipelines = (harness: Harness) =>
  Effect.gen(function* () {
    const bots = yield* harness.service;
    const projects = {
      get: () => Effect.succeedSome({ workspaceRoot: "/repo", deletedAt: null }),
    } as unknown as ProjectStore.ProjectStoreV2["Service"];
    const provideDeps = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      harness
        .provide(effect)
        .pipe(
          Effect.provideService(BotsService, bots),
          Effect.provideService(ProjectStore.ProjectStoreV2, projects),
          Effect.provideService(GitVcsDriver, {} as GitVcsDriver["Service"]),
          Effect.provideService(PullRequestService, {} as PullRequestService["Service"]),
          Effect.provideService(WorkspaceEntries, {} as WorkspaceEntries["Service"]),
        );
    const batches = yield* provideDeps(makeBotBatches);
    const pipelinesIn = (scope: Scope.Scope) =>
      provideDeps(make).pipe(
        Effect.provideService(BotBatches, batches),
        Effect.provideService(Scope.Scope, scope),
      );
    for (const bot of verdictBots) yield* bots.save(bot, USER_CALLER);
    return { bots, batches, pipelines: yield* pipelinesIn(yield* Effect.scope), pipelinesIn };
  });

describe("BotPipelines", () => {
  it.effect("reviews, fixes each finding, loops back on a failed verify and completes", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { pipelines } = yield* makePipelines(harness);
        yield* pipelines.save({ pipeline: reviewFixVerify(3) }, USER_CALLER);
        const run = yield* pipelines.run(
          { pipelineId: "review-fix", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        expect(run).toMatchObject({ status: "running", cursorStepId: "review" });

        expect(yield* endNext(harness, verdict("fail", ["Off by one", "Null check"]))).toMatch(
          /^Review a\.ts\./,
        );
        // A finding came from an earlier run, so the fix sees it framed as untrusted data.
        const firstFix = yield* endNext(harness, "Fixed it.");
        expect(firstFix).toMatch(/^Fix <event-data-\w+>Off by one<\/event-data-\w+> in /);
        expect(firstFix).toContain("came from an earlier step of this run's pipeline");
        expect(yield* endNext(harness, "Fixed it.")).toContain(">Null check<");
        yield* endNext(harness, verdict("fail", ["Still off"]));
        // Round 2: the review finds nothing, so the fixes are skipped.
        yield* endNext(harness, verdict("pass"));
        yield* endNext(harness, verdict("pass"));

        const finished = yield* pipelines.awaitRun(run.id, WAIT_MS);
        expect(finished).toMatchObject({ status: "completed", finalVerdict: "pass" });
        const detail = yield* pipelines.getRun(run.id);
        expect(
          detail.attempts.map((attempt) => [attempt.stepId, attempt.round, attempt.state]),
        ).toEqual([
          ["review", 1, "done"],
          ["fix", 1, "done"],
          ["verify", 1, "done"],
          ["review", 2, "done"],
          ["fix", 2, "skipped"],
          ["verify", 2, "done"],
        ]);
        expect(detail.report.markdown).toContain(
          "Path: Review (fail), Fix, Verify (fail), Review (pass), Fix (skipped), Verify (pass)",
        );
      }),
    ),
  );

  it.effect("stops at the last round, shows the failing run in the inbox and resumes", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, pipelines } = yield* makePipelines(harness);
        yield* pipelines.save({ pipeline: reviewFixVerify(1) }, USER_CALLER);
        const run = yield* pipelines.run(
          { pipelineId: "review-fix", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        yield* endNext(harness, verdict("pass"));
        yield* endNext(harness, verdict("fail", ["Broken"]));
        const stopped = yield* pipelines.awaitRun(run.id, WAIT_MS);
        expect(stopped).toMatchObject({
          status: "stopped",
          error: "Verify still failed after 1 round.",
        });

        const inbox = yield* bots.inbox({ limit: 10 });
        expect(inbox.runs.map((item) => item.id)).toEqual([stopped.stoppedRunId]);
        const retried = yield* bots
          .retry({ runId: stopped.stoppedRunId! }, USER_CALLER)
          .pipe(Effect.flip);
        expect(retried.message).toBe(
          "This run belongs to a pipeline. Resume the pipeline instead.",
        );

        const resumed = yield* pipelines.resume(run.id, USER_CALLER);
        expect(resumed).toMatchObject({ status: "running", error: null, stoppedRunId: null });
        expect((yield* bots.inbox({ limit: 10 })).runs).toEqual([]);
        yield* endNext(harness, verdict("pass"));
        expect(yield* pipelines.awaitRun(run.id, WAIT_MS)).toMatchObject({ status: "completed" });
        const attempts = (yield* pipelines.getRun(run.id)).attempts;
        expect(attempts.map((attempt) => `${attempt.stepId}@${attempt.round}`)).toEqual([
          "review@1",
          "fix@1",
          "verify@1",
          "verify@1",
        ]);
      }),
    ),
  );

  it.effect("records a pinned step run on another computer as the version that runs there", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, pipelines } = yield* makePipelines(harness);
        const studio = EnvironmentId.make("env-studio");
        const submitted = yield* Deferred.make<number>();
        yield* bots.setAnywhereHooks({
          publish: (_definition, link) => Effect.succeed({ ...link, revision: link.revision + 1 }),
          resolveTarget: () => Effect.succeed({ environmentId: studio, label: "Studio" }),
          submit: (run) => Deferred.succeed(submitted, run.botVersion).pipe(Effect.asVoid),
          cancel: () => Effect.void,
          vaultLines: () => Effect.succeed([]),
        });
        const pinned = yield* bots.setLibraryLink("reviewer", {
          libraryBotId: "reviewer",
          revision: 1,
          libraryProjectId: null,
          syncedAt: "2026-10-20T00:00:00.000Z",
          modelOverride: null,
        });
        yield* bots.save({ ...versionInput(pinned), description: "Edited." }, USER_CALLER);
        const current = yield* bots.get("reviewer");
        yield* pipelines.save(
          {
            pipeline: {
              id: "remote-review",
              name: "Remote review",
              description: "",
              parameters: [{ name: "file", label: "File", type: "string", required: true }],
              steps: [
                {
                  id: "review",
                  botId: "reviewer",
                  version: pinned.version,
                  inputs: { file: "{{input.file}}" },
                  target: { type: "environment", environmentId: studio },
                },
              ],
            },
          },
          USER_CALLER,
        );
        const run = yield* pipelines.run(
          { pipelineId: "remote-review", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );

        expect(yield* Deferred.await(submitted)).toBe(current.version);
        const [attempt] = (yield* pipelines.getRun(run.id)).attempts;
        expect(attempt?.botVersion).toBe(current.version);
        expect(attempt?.botVersion).not.toBe(pinned.version);
      }),
    ),
  );

  it.effect("cancels the step's run with the pipeline", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, pipelines } = yield* makePipelines(harness);
        yield* pipelines.save({ pipeline: reviewFixVerify(1) }, USER_CALLER);
        const run = yield* pipelines.run(
          { pipelineId: "review-fix", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        yield* harness.nextLaunch;
        const cancelled = yield* pipelines.cancel(run.id);
        expect(cancelled.status).toBe("cancelled");
        const [attempt] = (yield* pipelines.getRun(run.id)).attempts;
        expect(attempt).toMatchObject({ state: "done" });
        expect(yield* bots.awaitRun(attempt!.runId!, WAIT_MS)).toMatchObject({
          status: "cancelled",
        });
      }),
    ),
  );

  it.effect("picks a run back up after a restart", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, pipelinesIn } = yield* makePipelines(harness);
        const before = yield* Scope.make();
        const first = yield* pipelinesIn(before);
        yield* first.save({ pipeline: reviewFixVerify(1) }, USER_CALLER);
        const run = yield* first.run(
          { pipelineId: "review-fix", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        const review = yield* harness.nextLaunch;
        yield* Scope.close(before, Exit.void);

        const after = yield* pipelinesIn(yield* Effect.scope);
        yield* bots.markRecovered;
        yield* after.recover();
        yield* harness.end(review.threadId!, { status: "completed", reply: verdict("pass") });
        yield* endNext(harness, verdict("pass"));
        expect(yield* after.awaitRun(run.id, WAIT_MS)).toMatchObject({ status: "completed" });
      }),
    ),
  );

  it.effect("refuses a pipeline whose bots do not fit, and a run missing an input", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { pipelines } = yield* makePipelines(harness);
        const broken = reviewFixVerify(1);
        const refused = yield* pipelines
          .save(
            {
              pipeline: {
                ...broken,
                steps: broken.steps.map((step) =>
                  step.id === "fix" ? { ...step, botId: "nobody" } : step,
                ),
              },
            },
            USER_CALLER,
          )
          .pipe(Effect.flip);
        expect(refused.message).toBe("Fix: There is no bot nobody.");

        yield* pipelines.save({ pipeline: broken }, USER_CALLER);
        const stale = yield* pipelines
          .save({ pipeline: broken, expectedVersion: 0 }, USER_CALLER)
          .pipe(Effect.flip);
        expect(stale.message).toMatch(/^This pipeline changed since it was opened\./);
        const missing = yield* pipelines
          .run({ pipelineId: "review-fix", inputs: {}, projectId }, USER_CALLER)
          .pipe(Effect.flip);
        expect(missing.reason).toBe("invalid");
      }),
    ),
  );
});
