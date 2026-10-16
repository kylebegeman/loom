import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  AuthSettingsWriteScope,
  EnvironmentId,
  ThreadId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  LIBRARY_BRIEF_WS_METHODS as BRIEF,
  LibraryError,
  type LibraryBriefProposalSource,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import * as Assets from "./assets/LibraryAssetService.ts";
import { resource } from "./Library.testkit.ts";
import * as LibraryService from "./LibraryService.ts";
import { ProjectLibraryToolkit } from "./mcp.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

const noAssets = Layer.succeed(Assets.LibraryAssetService, {
  mode: "local",
  find: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  read: () => Effect.fail(new LibraryError({ reason: "not-found" })),
  put: () => Effect.fail(new LibraryError({ reason: "io" })),
  url: () => Effect.succeed(null),
});
const serviceLayer = LibraryService.layer.pipe(
  Layer.provide(noAssets),
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
  ),
  Layer.provide(
    Layer.succeed(ServerEnvironmentIdentity, {
      getEnvironmentId: Effect.succeed(EnvironmentId.make("authority")),
    }),
  ),
);
const run = <A, E, R>(
  use: (service: LibraryService.LibraryService["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(ProjectLibraryMigrations);
    const service = yield* LibraryService.LibraryService.pipe(Effect.provide(serviceLayer));
    return yield* use(service);
  }).pipe(Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped);

const conversation: LibraryBriefProposalSource = {
  kind: "conversation",
  environmentId: EnvironmentId.make("computer"),
  threadId: ThreadId.make("thread-1"),
};
const isLibraryError = Schema.is(LibraryError);
const reason = (result: { readonly _tag: string; readonly failure?: unknown }) =>
  result._tag === "Failure" && isLibraryError(result.failure) ? result.failure.reason : result._tag;

const setup = (service: LibraryService.LibraryService["Service"]) =>
  Effect.gen(function* () {
    const project = yield* service.createProject({
      requestId: "create",
      title: "AspectAvy",
      brief: "Ship the viewer.",
      resources: [resource],
    });
    const propose = (
      requestId: string,
      proposedBrief: string,
      source: LibraryBriefProposalSource = conversation,
    ) =>
      service.proposeBrief(
        {
          requestId,
          projectId: project.id,
          baseRevision: project.revision,
          proposedBrief,
          summary: "Record the export decision.",
        },
        source,
      );
    return { project, propose };
  });

describe("Library brief proposals", () => {
  it.effect("accepting saves the brief as the next revision and records which one", () =>
    run((service) =>
      Effect.gen(function* () {
        const { project, propose } = yield* setup(service);
        const proposal = yield* propose("propose", "Ship the viewer. Export as STEP.");
        expect(proposal).toMatchObject({ status: "pending", baseRevision: project.revision });
        expect(proposal.source).toEqual(conversation);

        const accept = {
          requestId: "accept",
          proposalId: proposal.id,
          expectedRevision: project.revision,
        };
        const accepted = yield* service.acceptBriefProposal(accept);
        expect(accepted.project.revision).toBe(project.revision + 1);
        expect(accepted.project.brief).toBe("Ship the viewer. Export as STEP.");
        expect(accepted.project.title).toBe(project.title);
        expect(accepted.proposal).toMatchObject({
          status: "accepted",
          acceptedRevision: project.revision + 1,
        });
        expect((yield* service.project({ projectId: project.id })).revision).toBe(
          project.revision + 1,
        );
        // A retried request replays its receipt instead of deciding twice.
        expect(yield* service.acceptBriefProposal(accept)).toEqual(accepted);

        const listed = yield* service.briefProposals({
          projectId: project.id,
          status: "accepted",
        });
        expect(listed.proposals.map((entry) => entry.id)).toEqual([proposal.id]);

        const sql = yield* SqlClient.SqlClient;
        const events = yield* sql<{
          event_type: string;
        }>`SELECT event_type FROM fork_library_events WHERE event_type LIKE 'brief.%' ORDER BY sequence`;
        expect(events.map((event) => event.event_type)).toEqual([
          "brief.proposed",
          "brief.revised",
        ]);
      }),
    ),
  );

  it.effect("accepting against a stale revision fails with revision-conflict", () =>
    run((service) =>
      Effect.gen(function* () {
        const { project, propose } = yield* setup(service);
        const proposal = yield* propose("propose", "Ship the viewer. Export as STEP.");
        yield* service.updateProject({
          requestId: "edit",
          projectId: project.id,
          expectedRevision: project.revision,
          title: project.title,
          brief: "Ship the viewer and the slicer.",
          resources: project.resources,
        });

        const stale = yield* Effect.result(
          service.acceptBriefProposal({
            requestId: "accept-stale",
            proposalId: proposal.id,
            expectedRevision: project.revision,
          }),
        );
        expect(reason(stale)).toBe("revision-conflict");
        // Current revision, but the proposal was written against the old brief.
        const unrebased = yield* Effect.result(
          service.acceptBriefProposal({
            requestId: "accept-unrebased",
            proposalId: proposal.id,
            expectedRevision: project.revision + 1,
          }),
        );
        expect(reason(unrebased)).toBe("revision-conflict");
        expect((yield* service.project({ projectId: project.id })).revision).toBe(
          project.revision + 1,
        );

        // The person merged it by hand against the current text.
        const merged = yield* service.acceptBriefProposal({
          requestId: "accept-merged",
          proposalId: proposal.id,
          expectedRevision: project.revision + 1,
          brief: "Ship the viewer and the slicer. Export as STEP.",
        });
        expect(merged.project).toMatchObject({
          revision: project.revision + 2,
          brief: "Ship the viewer and the slicer. Export as STEP.",
        });
        expect(merged.proposal.acceptedRevision).toBe(project.revision + 2);
      }),
    ),
  );

  it.effect("dismissed proposals stay listed and can no longer be accepted", () =>
    run((service) =>
      Effect.gen(function* () {
        const { project, propose } = yield* setup(service);
        const proposal = yield* propose("propose", "Ship the viewer. Export as STEP.");
        const dismissed = yield* service.dismissBriefProposal({
          requestId: "dismiss",
          proposalId: proposal.id,
        });
        expect(dismissed.status).toBe("dismissed");
        expect(dismissed.decidedAt).toBeDefined();

        const listed = yield* service.briefProposals({
          projectId: project.id,
          status: "dismissed",
        });
        expect(listed.proposals).toEqual([dismissed]);
        expect(
          (yield* service.briefProposals({ projectId: project.id, status: "pending" })).proposals,
        ).toEqual([]);
        const late = yield* Effect.result(
          service.acceptBriefProposal({
            requestId: "accept-late",
            proposalId: proposal.id,
            expectedRevision: project.revision,
          }),
        );
        expect(reason(late)).toBe("revision-conflict");
        expect((yield* service.project({ projectId: project.id })).revision).toBe(project.revision);
      }),
    ),
  );

  it.effect("a new proposal supersedes the same conversation's pending one", () =>
    run((service) =>
      Effect.gen(function* () {
        const { project, propose } = yield* setup(service);
        const first = yield* propose("first", "Ship the viewer. Export as STEP.");
        const other = yield* propose("other", "Ship the viewer. Export as 3MF.", {
          kind: "agent",
          id: "client-session",
          label: "Laptop agent",
        });
        const second = yield* propose("second", "Ship the viewer. Export as STEP and 3MF.");

        const all = yield* service.briefProposals({ projectId: project.id });
        expect(all.proposals.map((entry) => [entry.id, entry.status])).toEqual([
          [second.id, "pending"],
          [other.id, "pending"],
          [first.id, "superseded"],
        ]);
        const page = yield* service.briefProposals({ projectId: project.id, limit: 2 });
        expect(page.nextOffset).toBe(2);

        const unchanged = yield* Effect.result(propose("same", "Ship the viewer."));
        expect(reason(unchanged)).toBe("invalid");
      }),
    ),
  );
});

describe("Library brief proposal permissions", () => {
  it("gives agents propose and list tools but no way to accept or dismiss", () => {
    const tools = Object.keys(ProjectLibraryToolkit.tools).filter((name) =>
      name.startsWith("loom_library_brief"),
    );
    expect(tools.toSorted()).toEqual([
      "loom_library_brief_proposals",
      "loom_library_brief_propose",
    ]);
  });

  it.effect("deciding a proposal needs the settings grant that edits projects", () =>
    Effect.gen(function* () {
      const auth = (scopes: readonly AuthEnvironmentScope[]) =>
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("brief-test"),
          subject: "test",
          method: "bearer-access-token",
          scopes,
        });
      const operator = auth([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);
      expect(yield* operator.effect(BRIEF.propose, Effect.succeed("proposed"))).toBe("proposed");
      expect(yield* operator.effect(BRIEF.proposals, Effect.succeed("listed"))).toBe("listed");
      for (const method of [BRIEF.accept, BRIEF.dismiss]) {
        const denied = yield* Effect.flip(operator.effect(method, Effect.succeed("decided")));
        expect(denied.requiredScope).toBe(AuthSettingsWriteScope);
      }
      const editor = auth([AuthSettingsWriteScope]);
      expect(yield* editor.effect(BRIEF.accept, Effect.succeed("decided"))).toBe("decided");
    }),
  );
});
