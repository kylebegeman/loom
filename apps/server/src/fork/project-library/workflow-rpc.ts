import { PROJECT_WORKFLOW_WS_METHODS as W } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { LibraryManagement } from "./LibraryManagement.ts";
import { LibraryPublisher } from "./LibraryPublisher.ts";
import { ProjectWorkflows } from "./ProjectWorkflows.ts";
import { ProjectOperations } from "./ProjectOperations.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
export const makeProjectWorkflowRpcHandlers = Effect.fn("ProjectWorkflows.makeRpcHandlers")(
  function* (auth: ForkRpcAuth, session: AuthenticatedSession) {
    const workflows = yield* ProjectWorkflows;
    const operations = yield* ProjectOperations;
    const management = yield* LibraryManagement;
    const publisher = yield* LibraryPublisher;
    const actor = { kind: "client" as const, sessionId: session.sessionId };
    return {
      [W.changes]: () => auth.stream(W.changes, workflows.changes),
      [W.workstreams]: (input: Parameters<typeof workflows.workstreams>[0]) =>
        auth.effect(W.workstreams, publisher.workstreams(input)),
      [W.saveWorkstream]: (input: Parameters<typeof workflows.saveWorkstream>[0]) =>
        auth.effect(W.saveWorkstream, management.saveWorkstream(input, actor)),
      [W.blueprint]: (input: Parameters<typeof workflows.blueprint>[0]) =>
        auth.effect(W.blueprint, publisher.blueprint(input)),
      [W.applyBlueprint]: (input: Parameters<typeof workflows.applyBlueprint>[0]) =>
        auth.effect(
          W.applyBlueprint,
          management.execute({ kind: "apply-blueprint", input }, actor),
        ),
      [W.preservation]: (input: Parameters<typeof workflows.preservation>[0]) =>
        auth.effect(W.preservation, publisher.preservation(input)),
      [W.operations]: (input: Parameters<typeof operations.list>[0]) =>
        auth.effect(W.operations, operations.list(input)),
      [W.run]: (input: { operationId: string; request: Parameters<typeof operations.run>[1] }) =>
        auth.effect(W.run, operations.run(input.operationId, input.request, session)),
      [W.execute]: (input: {
        operationId: string;
        request: Parameters<typeof operations.run>[1];
      }) => auth.effect(W.execute, operations.execute(input.operationId, input.request, session)),
      [W.resume]: (input: { operationId: string }) =>
        auth.effect(W.resume, operations.resume(input.operationId, session)),
      [W.cancel]: (input: { operationId: string }) =>
        auth.effect(W.cancel, operations.cancel(input.operationId, session)),
    };
  },
);
