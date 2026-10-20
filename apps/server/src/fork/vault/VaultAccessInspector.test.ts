import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
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
              machineLabel: "Disposable runner",
              brokerState: "online",
            },
          ],
          approvals: [{ id: f.request.id, state: "pending" }],
          externalConsumers: "not-discovered",
          providerCopies: "unknown",
        });
        expect(JSON.stringify(report)).not.toContain(Redacted.value(f.machine.privateKey));
        expect(JSON.stringify(report)).not.toContain(f.machine.publicKey);
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
      const inbox = yield* original.approvalInbox;
      const foreignId = "0".repeat(32);
      const boundary = Layer.succeed(VaultAccess.VaultAccess, {
        ...original,
        approvalInbox: Effect.succeed({
          ...inbox,
          requests: [
            ...inbox.requests,
            { ...f.request, id: foreignId, threadId: ThreadId.make("foreign-thread") },
          ],
        }),
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
