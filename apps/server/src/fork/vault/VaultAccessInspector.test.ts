import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as VaultCore from "./VaultCore.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import * as Redacted from "effect/Redacted";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultAccessInspector from "./VaultAccessInspector.ts";
import * as SshTransport from "./SshTransport.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
const setup = Effect.gen(function* () {
  const f = yield* launchFixture(
    Layer.succeed(SshTransport.SshTransport, {
      execute: () => Effect.die("Inspector must never run SSH"),
    }),
  );
  yield* f.grant(f.key.destination);
  const profileId = yield* f.id;
  const profile = {
    id: profileId,
    label: "Context QA",
    bindings: [{ name: "server", kind: "ssh" as const, itemId: f.itemId, repository: null }],
  };
  yield* f.profiles.apply(
    {
      projectId: f.state.thread.projectId,
      operationId: yield* f.id,
      expectedRevision: 0,
      change: { type: "save", profile },
    },
    "admin",
  );
  yield* f.profiles.apply(
    {
      projectId: f.state.thread.projectId,
      operationId: yield* f.id,
      expectedRevision: 1,
      change: { type: "activate", id: profileId },
    },
    "admin",
  );
  const session = yield* f.session(f.key.destination);
  const request = yield* f.access.approvalCreate(
    {
      id: yield* f.id,
      threadId: f.threadId,
      itemId: f.itemId,
      action: "use",
      destination: f.key.destination,
    },
    `thread:${f.threadId}`,
    Effect.void,
  );
  const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
    Effect.provide(VaultAccessInspector.layer),
    Effect.provideContext(f.context),
  );
  const input = {
    threadId: f.threadId,
    itemId: f.itemId,
    action: "use" as const,
    destination: f.key.destination,
  };
  return { ...f, inspector, input, profile, session, request };
});
const withFixture = <A, E, R>(use: (f: Effect.Success<typeof setup>) => Effect.Effect<A, E, R>) =>
  setup.pipe(
    Effect.flatMap(use),
    Effect.scoped,
    Effect.provide(Layer.merge(NodeServices.layer, memoryVault)),
  );
it.effect(
  "joins only the selected thread/item's profile, workload and request context without writes or credentials",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const before = yield* f.access.snapshot;
        const report = yield* f.inspector.explain(f.input, true);
        expect(report.context).toMatchObject({
          state: "current",
          providerInstanceId: "codex",
          runId: f.state.thread.activeRunId,
          profiles: [{ id: f.profile.id, selected: true, requirements: ["server"] }],
          sessions: [
            {
              id: f.session.id,
              machineId: f.machineId,
              machineLabel: null,
              brokerState: "unknown",
            },
          ],
          approvals: [{ id: f.request.id, state: "pending" }],
          externalConsumers: "not-discovered",
          providerCopies: "unknown",
        });
        expect(JSON.stringify(report)).not.toContain(Redacted.value(f.machine.privateKey));
        expect(JSON.stringify(report)).not.toContain(f.machine.publicKey);
        const admin = yield* f.inspector.explain(f.input);
        expect(admin.context!.sessions).toEqual([
          expect.objectContaining({
            id: f.session.id,
            machineId: f.machineId,
            machineLabel: "Disposable runner",
            brokerState: "online",
          }),
        ]);
        expect(JSON.stringify(admin)).not.toContain(Redacted.value(f.machine.privateKey));
        expect(JSON.stringify(admin)).not.toContain(f.machine.publicKey);
        expect(yield* f.access.snapshot).toEqual(before);
        expect(report.context!.freshUntil).toBeGreaterThan(report.context!.checkedAt);
      }),
    ),
);
it.effect("omits all related counts and labels when the caller lacks inspect metadata access", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const policy = yield* f.access.snapshot;
      const original = policy.grants.find((g) => g.definition.id === f.grantId)!;
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: policy.revision,
          change: { type: "save", grant: { ...original.definition, actions: ["use"] } },
        },
        "admin",
      );
      const report = yield* f.inspector.explain(f.input, true);
      expect(report.decision.allowed).toBe(true);
      expect(report.item).toBeNull();
      expect(report.context).toBeUndefined();
      expect(JSON.stringify(report)).not.toContain("Context QA");
      expect(JSON.stringify(report)).not.toContain(f.request.id);
    }),
  ),
);
it.effect("filters another requester's retained approvals and unrelated profile bindings", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const original = Context.get(f.context, VaultAccess.VaultAccess);
      const requests = yield* original.approvalContext({
        threadId: f.threadId,
        projectId: f.state.thread.projectId,
        itemId: f.itemId,
        itemVersion: 1,
        runId: f.state.thread.activeRunId,
        restrictMetadata: true,
      });
      const foreignId = "0".repeat(32);
      const boundary = Layer.succeed(VaultAccess.VaultAccess, {
        ...original,
        approvalContext: () =>
          Effect.succeed([
            ...requests,
            { ...f.request, id: foreignId, threadId: ThreadId.make("foreign-thread") },
            { ...f.request, id: "1".repeat(32), projectId: ProjectId.make("foreign-project") },
            { ...f.request, id: "2".repeat(32), itemId: "3".repeat(32) },
          ]),
      });
      const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
        Effect.provide(VaultAccessInspector.layer.pipe(Layer.provide(boundary))),
        Effect.provideContext(f.context),
      );
      const report = yield* inspector.explain(f.input);
      expect(report.context!.approvals.map((r) => r.id)).toEqual([f.request.id]);
      expect(JSON.stringify(report.context)).not.toContain("foreign-thread");
      expect(JSON.stringify(report.context)).not.toContain(foreignId);
    }),
  ),
);
it.effect(
  "shows partial diagnostic context for a thread whose workload listing is unavailable",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        f.state.thread = { ...f.state.thread, runtimeMode: "approval-required" };
        const report = yield* f.inspector.explain(f.input);
        expect(report.context!.state).toBe("partial");
        expect(report.context!.sessions).toEqual([]);
        expect(report.context!.profiles[0]!.id).toBe(f.profile.id);
        expect(report.context!.approvals[0]!.id).toBe(f.request.id);
      }),
    ),
);
it.effect(
  "withdraws context observed across a changed run instead of displaying stale relationships",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const original = Context.get(f.context, VaultProfiles.VaultProfiles);
        let reads = 0;
        const boundary = Layer.succeed(VaultProfiles.VaultProfiles, {
          ...original,
          list: (projectId) =>
            Effect.gen(function* () {
              const page = yield* original.list(projectId);
              if (++reads === 1)
                f.state.thread = { ...f.state.thread, activeRunId: RunId.make("replacement") };
              return page;
            }).pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" }))),
        });
        const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
          Effect.provide(VaultAccessInspector.layer.pipe(Layer.provide(boundary))),
          Effect.provideContext(f.context),
        );
        const report = yield* inspector.explain(f.input);
        expect(report.context).toMatchObject({
          state: "changed",
          profiles: [],
          sessions: [],
          approvals: [],
        });
      }),
    ),
);
it.effect("bounds retained request and profile context with explicit omitted counts", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      for (let n = 1; n < 20; n++) {
        yield* f.access.approvalCreate(
          {
            id: yield* f.id,
            threadId: f.threadId,
            itemId: f.itemId,
            action: "use",
            destination: f.key.destination,
          },
          `thread:${f.threadId}`,
          Effect.void,
        );
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: (yield* f.profiles.list(f.state.thread.projectId)).revision,
            change: { type: "save", profile: { ...f.profile, id: yield* f.id, label: `QA ${n}` } },
          },
          "admin",
        );
      }
      const context = (yield* f.inspector.explain(f.input)).context!;
      expect(context.approvals).toHaveLength(16);
      expect(context.omittedApprovals).toBe(4);
      expect(context.profiles).toHaveLength(16);
      expect(context.omittedProfiles).toBe(4);
    }),
  ),
);

it.effect.each(["profile", "policy", "item", "expiry"] as const)(
  "withdraws related labels after %s drift across observation awaits",
  (drift) =>
    withFixture((f) =>
      Effect.gen(function* () {
        if (drift === "expiry") {
          const policy = yield* f.access.snapshot;
          const grant = policy.grants.find((g) => g.definition.id === f.grantId)!;
          yield* f.access.apply(
            {
              operationId: yield* f.id,
              expectedRevision: policy.revision,
              change: { type: "save", grant: { ...grant.definition, expiresAt: 100 } },
            },
            "admin",
          );
        }
        const original = Context.get(f.context, VaultProfiles.VaultProfiles);
        let reads = 0;
        const boundary = Layer.succeed(VaultProfiles.VaultProfiles, {
          ...original,
          list: (projectId) =>
            Effect.gen(function* () {
              const page = yield* original.list(projectId);
              if (++reads === 1) {
                if (drift === "profile")
                  yield* f.profiles.apply(
                    {
                      projectId,
                      operationId: yield* f.id,
                      expectedRevision: page.revision,
                      change: { type: "save", profile: { ...f.profile, label: "Changed" } },
                    },
                    "admin",
                  );
                else if (drift === "policy")
                  yield* f.access.apply(
                    {
                      operationId: yield* f.id,
                      expectedRevision: (yield* f.access.snapshot).revision,
                      change: { type: "state", id: f.grantId, state: "revoked" },
                    },
                    "admin",
                  );
                else if (drift === "item")
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
                else yield* TestClock.adjust("61 seconds");
              }
              return page;
            }).pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" }))),
        });
        const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
          Effect.provide(VaultAccessInspector.layer.pipe(Layer.provide(boundary))),
          Effect.provideContext(f.context),
        );
        expect((yield* inspector.explain(f.input)).context).toMatchObject({
          state: "changed",
          profiles: [],
          sessions: [],
          approvals: [],
        });
      }),
    ),
);
it.effect("filters sessions by provider and reports capped workload observations", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const original = Context.get(f.context, VaultWorkloads.VaultWorkloads);
      const rows = Array.from({ length: 10 }, (_, n) => ({
        ...f.session,
        id: n.toString(16).padStart(32, "0"),
      }));
      const foreignId = "f".repeat(32);
      const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
        Effect.provide(
          VaultAccessInspector.layer.pipe(
            Layer.provide(
              Layer.succeed(VaultWorkloads.VaultWorkloads, {
                ...original,
                list: () =>
                  Effect.succeed([
                    ...rows,
                    {
                      ...f.session,
                      id: foreignId,
                      providerInstanceId: ProviderInstanceId.make("foreign"),
                    },
                  ]),
              }),
            ),
          ),
        ),
        Effect.provideContext(f.context),
      );
      const context = (yield* inspector.explain(f.input)).context!;
      expect(context.sessions).toHaveLength(8);
      expect(context.omittedSessions).toBe(2);
      expect(context.sessions.some((s) => s.id === foreignId)).toBe(false);
    }),
  ),
);

it.effect(
  "does not disclose same-thread requests filed by another requester or build the full inbox",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const foreign = yield* f.access.approvalCreate(
          {
            id: yield* f.id,
            threadId: f.threadId,
            itemId: f.itemId,
            action: "use",
            destination: f.key.destination,
          },
          "client:foreign",
          Effect.void,
        );
        expect(
          (yield* f.access.approvalStatus(foreign.id, f.threadId).pipe(Effect.flip)).reason,
        ).toBe("not-found");
        const original = Context.get(f.context, VaultAccess.VaultAccess);
        const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
          Effect.provide(
            VaultAccessInspector.layer.pipe(
              Layer.provide(
                Layer.succeed(VaultAccess.VaultAccess, {
                  ...original,
                  approvalInbox: Effect.die("Inspector must not build the environment inbox"),
                }),
              ),
            ),
          ),
          Effect.provideContext(f.context),
        );
        expect(
          (yield* f.access.approvalContext({
            threadId: f.threadId,
            projectId: f.state.thread.projectId,
            itemId: f.itemId,
            itemVersion: 1,
            runId: f.state.thread.activeRunId,
            restrictMetadata: true,
          })).map((r) => r.id),
        ).toEqual([f.request.id]);
        const agent = yield* inspector.explain(f.input, true);
        expect(agent.context!.approvals.map((r) => r.id)).toEqual([f.request.id]);
        const admin = yield* inspector.explain(f.input);
        expect(admin.context!.approvals.map((r) => r.id)).toContain(foreign.id);
      }),
    ),
);
it.effect("omits live approvals bound to an old item version or a replaced run", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const bound = yield* f.access.approvalCreate(
        {
          id: yield* f.id,
          waitingOperationId: yield* f.id,
          threadId: f.threadId,
          itemId: f.itemId,
          action: "use",
          destination: f.key.destination,
        },
        `thread:${f.threadId}`,
        Effect.void,
      );
      f.state.thread = { ...f.state.thread, activeRunId: RunId.make("replacement") };
      const runReport = yield* f.inspector.explain(f.input, true);
      expect(runReport.context!.approvals.some((r) => r.id === bound.id)).toBe(false);
      expect((yield* f.access.approvalStatus(bound.id, f.threadId)).operationState).toBe(
        "stale-run",
      );
      yield* f.ssh.trust(
        {
          id: f.itemId,
          expectedVersion: 1,
          operationId: yield* f.id,
          hostKey: f.key.target.hostKey,
        },
        "admin",
        Effect.void,
      );
      const rotated = yield* f.inspector.explain(f.input, true);
      expect(rotated.context!.approvals).toEqual([]);
    }),
  ),
);
it.effect("keeps healthy session and request context when profiles stay unavailable", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const original = Context.get(f.context, VaultProfiles.VaultProfiles);
      const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
        Effect.provide(
          VaultAccessInspector.layer.pipe(
            Layer.provide(
              Layer.succeed(VaultProfiles.VaultProfiles, {
                ...original,
                list: () => Effect.fail(new VaultError({ reason: "invalid-response" })),
              }),
            ),
          ),
        ),
        Effect.provideContext(f.context),
      );
      const report = yield* inspector.explain(f.input);
      expect(report.context).toMatchObject({
        state: "partial",
        profiles: [],
        sessions: [{ id: f.session.id }],
        approvals: [{ id: f.request.id }],
      });
    }),
  ),
);
it.effect("time-bounds a slow context source and preserves the completed policy decision", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const original = Context.get(f.context, VaultProfiles.VaultProfiles),
        started = yield* Deferred.make<void>();
      const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
        Effect.provide(
          VaultAccessInspector.layer.pipe(
            Layer.provide(
              Layer.succeed(VaultProfiles.VaultProfiles, {
                ...original,
                list: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
              }),
            ),
          ),
        ),
        Effect.provideContext(f.context),
      );
      const fiber = yield* inspector.explain(f.input).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("501 millis");
      const report = yield* Fiber.join(fiber);
      expect(report.decision.allowed).toBe(true);
      expect(report.context).toMatchObject({
        state: "partial",
        sessions: [{ id: f.session.id }],
        approvals: [{ id: f.request.id }],
      });
    }),
  ),
);
it.effect(
  "anchors context to the run before the decision instead of relabelling an older decision",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const original = Context.get(f.context, VaultAccess.VaultAccess);
        const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
          Effect.provide(
            VaultAccessInspector.layer.pipe(
              Layer.provide(
                Layer.succeed(VaultAccess.VaultAccess, {
                  ...original,
                  explain: (...args) =>
                    Effect.gen(function* () {
                      const report = yield* original.explain(...args);
                      f.state.thread = {
                        ...f.state.thread,
                        activeRunId: RunId.make("started-after-decision"),
                      };
                      return report;
                    }),
                }),
              ),
            ),
          ),
          Effect.provideContext(f.context),
        );
        expect((yield* inspector.explain(f.input)).context).toMatchObject({
          state: "changed",
          profiles: [],
          sessions: [],
          approvals: [],
        });
      }),
    ),
);
it.effect(
  "filters unrelated profile records and bindings rather than treating every profile as a consumer",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const foreignItem = yield* f.id,
          foreignProfile = yield* f.id;
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: 2,
            change: {
              type: "save",
              profile: {
                ...f.profile,
                bindings: [
                  ...f.profile.bindings,
                  { ...f.profile.bindings[0]!, name: "foreign", itemId: foreignItem },
                ],
              },
            },
          },
          "admin",
        );
        yield* f.profiles.apply(
          {
            projectId: f.state.thread.projectId,
            operationId: yield* f.id,
            expectedRevision: 3,
            change: {
              type: "save",
              profile: {
                ...f.profile,
                id: foreignProfile,
                label: "Unrelated profile",
                bindings: [{ ...f.profile.bindings[0]!, itemId: foreignItem }],
              },
            },
          },
          "admin",
        );
        const context = (yield* f.inspector.explain(f.input)).context!;
        expect(context.profiles).toHaveLength(1);
        expect(context.profiles[0]!.requirements).toEqual(["server"]);
        expect(context.profiles[0]!.id).toBe(f.profile.id);
      }),
    ),
);
it.effect("filters every session identity dimension and ignores expired sessions", () =>
  withFixture((f) =>
    Effect.gen(function* () {
      const original = Context.get(f.context, VaultWorkloads.VaultWorkloads);
      const alternatives = [
        { threadId: ThreadId.make("foreign") },
        { runId: RunId.make("foreign") },
        { providerInstanceId: ProviderInstanceId.make("foreign") },
        { projectId: ProjectId.make("foreign") },
        { environmentId: EnvironmentId.make("foreign") },
        { itemId: "e".repeat(32) },
        { expiresAt: 0 },
      ];
      const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
        Effect.provide(
          VaultAccessInspector.layer.pipe(
            Layer.provide(
              Layer.succeed(VaultWorkloads.VaultWorkloads, {
                ...original,
                list: () =>
                  Effect.succeed([
                    f.session,
                    ...alternatives.map((x, n) => ({
                      ...f.session,
                      ...x,
                      id: n.toString(16).padStart(32, "0"),
                    })),
                  ]),
              }),
            ),
          ),
        ),
        Effect.provideContext(f.context),
      );
      expect((yield* inspector.explain(f.input)).context!.sessions.map((s) => s.id)).toEqual([
        f.session.id,
      ]);
    }),
  ),
);
it.effect(
  "sorts pending requests first then newest, without expiring context on decided history",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const original = Context.get(f.context, VaultAccess.VaultAccess),
          newer = "d".repeat(32),
          decided = "e".repeat(32);
        yield* TestClock.adjust("1 second");
        const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
          Effect.provide(
            VaultAccessInspector.layer.pipe(
              Layer.provide(
                Layer.succeed(VaultAccess.VaultAccess, {
                  ...original,
                  approvalContext: () =>
                    Effect.succeed([
                      {
                        ...f.request,
                        id: decided,
                        state: "denied",
                        requestedAt: 900,
                        requestExpiresAt: 0,
                      },
                      f.request,
                      { ...f.request, id: newer, requestedAt: 500 },
                    ]),
                }),
              ),
            ),
          ),
          Effect.provideContext(f.context),
        );
        const context = (yield* inspector.explain(f.input)).context!;
        expect(context.state).toBe("current");
        expect(context.approvals.map((r) => r.id)).toEqual([newer, f.request.id, decided]);
        expect(context.freshUntil).toBeGreaterThan(context.checkedAt);
      }),
    ),
);
it.effect(
  "starts all final consistency reads concurrently and bounds unavailable verification",
  () =>
    withFixture((f) =>
      Effect.gen(function* () {
        const markers = yield* Effect.all(Array.from({ length: 4 }, () => Deferred.make<void>()));
        const gate = (n: number) =>
          Deferred.succeed(markers[n]!, undefined).pipe(Effect.andThen(Effect.never));
        const originalThread = Context.get(f.context, ThreadManagementService),
          originalProfiles = Context.get(f.context, VaultProfiles.VaultProfiles),
          originalAccess = Context.get(f.context, VaultAccess.VaultAccess),
          originalCore = Context.get(f.context, VaultCore.VaultCore);
        let threadReads = 0,
          profileReads = 0;
        const boundaries = Layer.mergeAll(
          Layer.succeed(ThreadManagementService, {
            ...originalThread,
            getThreadShell: (id) =>
              ++threadReads === 3 ? gate(0) : originalThread.getThreadShell(id),
          }),
          Layer.succeed(VaultProfiles.VaultProfiles, {
            ...originalProfiles,
            list: (id) => (++profileReads === 2 ? gate(1) : originalProfiles.list(id)),
          }),
          Layer.succeed(VaultAccess.VaultAccess, { ...originalAccess, snapshot: gate(2) }),
          Layer.succeed(VaultCore.VaultCore, { ...originalCore, inspect: () => gate(3) }),
        );
        const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
          Effect.provide(VaultAccessInspector.layer.pipe(Layer.provide(boundaries))),
          Effect.provideContext(f.context),
        );
        const fiber = yield* inspector.explain(f.input).pipe(Effect.forkChild);
        yield* Effect.all(markers.map(Deferred.await), { concurrency: 4 });
        yield* TestClock.adjust("501 millis");
        const report = yield* Fiber.join(fiber);
        expect(report.decision.allowed).toBe(true);
        expect(report.context!.state).toBe("unavailable");
      }),
    ),
);

it.effect.each(["offline", "disabled", "foreign-environment"] as const)(
  "keeps the admin broker join scoped and reports %s safely",
  (scenario) =>
    withFixture((f) =>
      Effect.gen(function* () {
        const snapshot = yield* f.brokers.snapshot;
        const inspector = yield* VaultAccessInspector.VaultAccessInspector.pipe(
          Effect.provide(
            VaultAccessInspector.layer.pipe(
              Layer.provide(
                Layer.succeed(VaultBrokers.VaultBrokers, {
                  ...f.brokers,
                  snapshot: Effect.succeed({
                    ...snapshot,
                    environmentId:
                      scenario === "foreign-environment"
                        ? EnvironmentId.make("foreign-environment")
                        : snapshot.environmentId,
                    machines: snapshot.machines.map((m) => ({
                      ...m,
                      state: scenario === "disabled" ? "disabled" : m.state,
                      leaseUntil: scenario === "offline" ? 0 : m.leaseUntil,
                    })),
                  }),
                }),
              ),
            ),
          ),
          Effect.provideContext(f.context),
        );
        const report = yield* inspector.explain(f.input);
        expect(report.context!.sessions).toEqual([
          expect.objectContaining({
            id: f.session.id,
            machineLabel: scenario === "foreign-environment" ? null : "Disposable runner",
            brokerState: scenario === "foreign-environment" ? "unknown" : scenario,
          }),
        ]);
        expect(JSON.stringify(report)).not.toContain(Redacted.value(f.machine.privateKey));
        expect(JSON.stringify(report)).not.toContain(f.machine.publicKey);
      }),
    ),
);
