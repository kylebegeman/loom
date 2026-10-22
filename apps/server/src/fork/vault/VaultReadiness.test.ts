import { newerVaultRun, vaultRun } from "./VaultActiveRun.testkit.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { RunId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultReadiness from "./VaultReadiness.ts";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";

const setup = Effect.gen(function* () {
  let executions = 0;
  const f = yield* launchFixture(
    Layer.succeed(SshTransport.SshTransport, {
      execute: () =>
        Effect.sync(() => {
          executions++;
          return { exitCode: 0, stdout: "" };
        }),
    }),
  );
  const service = yield* VaultReadiness.VaultReadiness.pipe(
    Effect.provide(VaultReadiness.layer),
    Effect.provideContext(f.context),
  );
  const profileId = yield* f.id;
  const profile = {
    id: profileId,
    label: "Development SSH",
    bindings: [{ name: "server", kind: "ssh" as const, itemId: f.itemId, repository: null }],
  };
  const save = (bindings = profile.bindings) =>
    Effect.gen(function* () {
      yield* f.profiles.apply(
        {
          projectId: f.state.thread.projectId,
          operationId: yield* f.id,
          expectedRevision: (yield* f.profiles.list(f.state.thread.projectId)).revision,
          change: { type: "save", profile: { ...profile, bindings } },
        },
        "admin",
      );
    });
  yield* save();
  yield* f.profiles.apply(
    {
      projectId: f.state.thread.projectId,
      operationId: yield* f.id,
      expectedRevision: 1,
      change: { type: "activate", id: profileId },
    },
    "admin",
  );
  return { ...f, service, profile, save, executions: () => executions };
});
const withFixture = <A, E, R>(use: (f: Effect.Success<typeof setup>) => Effect.Effect<A, E, R>) =>
  setup.pipe(
    Effect.flatMap(use),
    Effect.scoped,
    Effect.provide(Layer.merge(NodeServices.layer, memoryVault)),
  );
it.effect(
  "discovers default profile requirements and enrolled presence without creating a run pin or contacting SSH",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant(f.key.destination);
        const before = yield* f.access.snapshot;
        const result = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(result.decisions.map((d) => d.allowed)).toEqual([true]);
        expect(result.checks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "profile-default", state: "passed" }),
            expect.objectContaining({ id: "profile-binding:server", state: "passed" }),
            expect.objectContaining({ id: "provider-runtime", state: "passed" }),
            expect.objectContaining({ id: "enrolled-broker", state: "passed" }),
            expect.objectContaining({ id: "broker-delivery", state: "unsupported" }),
          ]),
        );
        expect(result.ready).toBe(false);
        expect(f.executions()).toBe(0);
        expect(
          (yield* f.profiles.pins({ projectId: f.state.thread.projectId, cursor: null })).items,
        ).toEqual([]);
        expect(yield* f.access.snapshot).toEqual(before);
      }),
    ),
);
it.effect("keeps explicit inspect checks independent of project defaults and broker presence", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant(f.key.destination);
      const result = yield* f.service.check({
        threadId: f.threadId,
        requirements: [{ itemId: f.itemId, action: "inspect", destination: f.key.destination }],
      });
      expect(result.ready).toBe(true);
      expect(
        result.checks.some((c) => c.id.startsWith("profile") || c.id === "enrolled-broker"),
      ).toBe(false);
      expect(f.executions()).toBe(0);
    }),
  ),
);
it.effect(
  "treats no profile as optional and reports configured missing bindings with repair guidance",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: 2,
            change: { type: "activate", id: null },
          },
          "admin",
        );
        expect(
          (yield* f.service.check({ threadId: f.threadId, requirements: [] })).checks,
        ).toContainEqual(expect.objectContaining({ id: "profile-default", state: "passed" }));
        yield* f.save([{ ...f.profile.bindings[0]!, itemId: null } as never]);
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: 4,
            change: { type: "activate", id: f.profile.id },
          },
          "admin",
        );
        const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(report.checks).toContainEqual(
          expect.objectContaining({
            id: "profile-binding:server",
            state: "blocked",
            reason: "Profile requirement server is missing.",
          }),
        );
        expect(report.ready).toBe(false);
      }),
    ),
);
it.effect(
  "classifies expired broker presence and permission-limited providers without claiming headless readiness",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant(f.key.destination);
        yield* TestClock.adjust("10 minutes");
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
        const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(report.checks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "provider-runtime", state: "blocked" }),
            expect.objectContaining({ id: "enrolled-broker", state: "blocked" }),
          ]),
        );
        expect(report.ready).toBe(false);
        expect(f.executions()).toBe(0);
      }),
    ),
);
it.effect(
  "denies derived use through the same evaluator and detects a run changed across an awaited check",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const denied = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(denied.decisions.map((d) => d.allowed)).toEqual([false]);
        const original = Context.get(f.context, VaultAccess.VaultAccess);
        let calls = 0;
        const moving = Layer.succeed(VaultAccess.VaultAccess, {
          ...original,
          readiness: (input) =>
            Effect.gen(function* () {
              const report = yield* original.readiness(input);
              if (++calls === 2)
                f.state.thread = {
                  ...f.state.thread,
                  activeRunId: RunId.make("changed-during-readiness"),
                };
              return report;
            }),
        });
        const service = yield* VaultReadiness.VaultReadiness.pipe(
          Effect.provide(VaultReadiness.layer.pipe(Layer.provide(moving))),
          Effect.provideContext(f.context),
        );
        const changed = yield* service.check({ threadId: f.threadId, requirements: [] });
        expect(changed.checks).toContainEqual(
          expect.objectContaining({ id: "context-changed", state: "blocked" }),
        );
      }),
    ),
);
it.effect("detects a profile changed during configuration inspection", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const original = Context.get(f.context, VaultProfiles.VaultProfiles);
      const changing = Layer.succeed(VaultProfiles.VaultProfiles, {
        ...original,
        preview: (input) =>
          Effect.gen(function* () {
            const report = yield* original.preview(input);
            yield* f.save().pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" })));
            return report;
          }),
      });
      const service = yield* VaultReadiness.VaultReadiness.pipe(
        Effect.provide(VaultReadiness.layer.pipe(Layer.provide(changing))),
        Effect.provideContext(f.context),
      );
      const report = yield* service.check({ threadId: f.threadId, requirements: [] });
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: "profile-changed", state: "blocked" }),
      );
    }),
  ),
);
it.effect("preserves a sealed backend report without reading profiles or brokers", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const original = Context.get(f.context, VaultAccess.VaultAccess);
      const baseline = yield* original.readiness({ threadId: f.threadId, requirements: [] });
      const locked = {
        ...baseline,
        ready: false,
        backend: { ...baseline.backend, state: "locked" as const },
      };
      const service = yield* VaultReadiness.VaultReadiness.pipe(
        Effect.provide(
          VaultReadiness.layer.pipe(
            Layer.provide(
              Layer.mock(VaultAccess.VaultAccess)({ readiness: () => Effect.succeed(locked) }),
            ),
          ),
        ),
        Effect.provideContext(f.context),
      );
      expect(yield* service.check({ threadId: f.threadId, requirements: [] })).toEqual(locked);
    }),
  ),
);

it.effect("reports a visible expired result after an unusually slow check", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant(f.key.destination);
      const original = Context.get(f.context, VaultAccess.VaultAccess);
      const slow = Layer.succeed(VaultAccess.VaultAccess, {
        ...original,
        readiness: (input) =>
          Effect.gen(function* () {
            const report = yield* original.readiness(input);
            yield* TestClock.adjust("61 seconds");
            return report;
          }),
      });
      const service = yield* VaultReadiness.VaultReadiness.pipe(
        Effect.provide(VaultReadiness.layer.pipe(Layer.provide(slow))),
        Effect.provideContext(f.context),
      );
      const report = yield* service.check({
        threadId: f.threadId,
        requirements: [{ itemId: f.itemId, action: "inspect", destination: f.key.destination }],
      });
      expect(report.ready).toBe(false);
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: "result-expired", state: "blocked" }),
      );
    }),
  ),
);

it.effect(
  "uses an attached run pin even with no project default, then ignores a changed default",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant(f.key.destination);
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: 2,
            change: { type: "activate", id: null },
          },
          "admin",
        );
        const pin = yield* f.profiles.resolve(f.threadId, f.profile.id);
        const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(report.checks).toContainEqual(
          expect.objectContaining({ id: "profile-pin", state: "passed" }),
        );
        expect(report.checks.some((c) => c.id === "profile-default")).toBe(false);
        expect(report.decisions.map((d) => d.allowed)).toEqual([true]);
        const otherId = yield* f.id;
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: 3,
            change: {
              type: "save",
              profile: {
                ...f.profile,
                id: otherId,
                bindings: [{ ...f.profile.bindings[0]!, itemId: null }],
              },
            },
          },
          "admin",
        );
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: 4,
            change: { type: "activate", id: otherId },
          },
          "admin",
        );
        const switched = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(switched.checks).toContainEqual(
          expect.objectContaining({ id: "profile-binding:server", state: "passed" }),
        );
        expect(switched.decisions.map((d) => d.allowed)).toEqual([true]);
        expect(
          (yield* f.profiles.pins({ projectId: f.state.thread.projectId, cursor: null })).items,
        ).toHaveLength(1);
        expect(pin.profileId).toBe(f.profile.id);
      }),
    ),
);
it.effect(
  "blocks a rotated key in a run pin instead of inspecting only the latest configured version",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant(f.key.destination);
        yield* f.profiles.resolve(f.threadId, f.profile.id);
        yield* f.ssh.trust(
          {
            id: f.itemId,
            operationId: yield* f.id,
            expectedVersion: 1,
            hostKey: f.key.target.hostKey,
          },
          "admin",
          Effect.void,
        );
        const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(report.checks).toContainEqual(
          expect.objectContaining({ id: "profile-binding:server", state: "blocked" }),
        );
        expect(report.ready).toBe(false);
      }),
    ),
);
it.effect("distinguishes SSH and Git grants for one key without disclosing destinations", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant(f.key.destination);
      yield* f.save([
        f.profile.bindings[0]!,
        { name: "repository", kind: "git", itemId: f.itemId, repository: "owner/repo" },
      ] as never);
      const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
      const grants = report.checks.filter((c) => c.id.startsWith("grant:"));
      expect(grants).toHaveLength(2);
      expect(JSON.stringify(grants)).not.toContain(f.key.target.hostname);
      expect(JSON.stringify(grants)).not.toContain("owner/repo");
      expect(new Set(report.checks.map((c) => c.id)).size).toBe(report.checks.length);
      expect(grants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            state: "passed",
            reason: "allowed",
          }),
          expect.objectContaining({
            state: "blocked",
            reason: expect.any(String),
          }),
        ]),
      );
    }),
  ),
);

it.effect(
  "does not fall back to the default when the current run pin is retired or unreadable",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const original = Context.get(f.context, VaultProfiles.VaultProfiles);
        const service = yield* VaultReadiness.VaultReadiness.pipe(
          Effect.provide(
            VaultReadiness.layer.pipe(
              Layer.provide(
                Layer.succeed(VaultProfiles.VaultProfiles, {
                  ...original,
                  currentPin: () => Effect.fail(new VaultError({ reason: "denied" })),
                }),
              ),
            ),
          ),
          Effect.provideContext(f.context),
        );
        const report = yield* service.check({ threadId: f.threadId, requirements: [] });
        expect(report.checks).toContainEqual(
          expect.objectContaining({ id: "profile-pin", state: "blocked" }),
        );
        expect(
          report.checks.some(
            (c) => c.id === "profile-default" || c.id.startsWith("profile-binding:"),
          ),
        ).toBe(false);
        expect(report.ready).toBe(false);
      }),
    ),
);
it.effect("preserves a run pin through profile re-save as execution does", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.grant(f.key.destination);
      yield* f.profiles.resolve(f.threadId, f.profile.id);
      yield* f.profiles.apply(
        {
          projectId: f.state.thread.projectId,
          operationId: yield* f.id,
          expectedRevision: 2,
          change: { type: "save", profile: { ...f.profile, label: "Renamed profile" } },
        },
        "admin",
      );
      const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
      expect(report.checks).toContainEqual(
        expect.objectContaining({ id: "profile-pin", state: "passed" }),
      );
      expect(report.checks.some((c) => c.id === "profile-changed")).toBe(false);
      expect((yield* f.profiles.resolve(f.threadId, null)).profileVersion).toBe(1);
    }),
  ),
);

it.effect("does not disclose discovered destinations to a thread without item inspect", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      yield* f.save([
        f.profile.bindings[0]!,
        { name: "repository", kind: "git", itemId: f.itemId, repository: "owner/repo" },
      ] as never);
      const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
      expect(report.decisions.every((d) => !d.allowed)).toBe(true);
      expect(JSON.stringify(report.checks)).not.toContain(f.key.destination);
      expect(JSON.stringify(report.checks)).not.toContain("owner/repo");
      expect(new Set(report.checks.map((c) => c.id)).size).toBe(report.checks.length);
    }),
  ),
);

it.effect.each(["cancelled", "completed"] as const)(
  "reports provider readiness for the actual run after a newer %s turn",
  (status) =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant(f.key.destination);
        newerVaultRun(f.state, status);
        const report = yield* f.service.check({ threadId: f.threadId, requirements: [] });
        expect(report.checks).toContainEqual(
          expect.objectContaining({ id: "provider-runtime", state: "passed" }),
        );
        expect(report.checks.some((check) => check.id === "context-changed")).toBe(false);
        expect(report.checks).toContainEqual(
          expect.objectContaining({ id: "broker-delivery", state: "unsupported" }),
        );
        expect(report.ready).toBe(false);
      }),
    ),
);

it.effect(
  "reports a queued active root run as live, without treating background drain as root ownership",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        yield* f.grant(f.key.destination);
        f.state.runs.push(vaultRun(f.state.thread));
        f.state.thread = { ...f.state.thread, status: "queued" };
        expect(
          (yield* f.service.check({ threadId: f.threadId, requirements: [] })).checks,
        ).toContainEqual(expect.objectContaining({ id: "provider-runtime", state: "passed" }));
        f.state.thread = { ...f.state.thread, status: "waiting", activeRunId: null };
        expect(
          (yield* f.service.check({ threadId: f.threadId, requirements: [] })).checks,
        ).toContainEqual(expect.objectContaining({ id: "provider-runtime", state: "blocked" }));
      }),
    ),
);
