import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  McpInvocationContext,
  type McpClientCaller,
  type McpInvocationScope,
} from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ProjectCheckoutManagement } from "../../project/ProjectCheckoutManagement.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ProjectCheckoutToolkit, projectCheckoutHandlers } from "./mcp.ts";

const projectId = ProjectId.make("checkout-mcp-project");
const request = {
  projectId,
  reviewToken: "abcdef0123456789".repeat(4),
  retention: "keep" as const,
};
const preview: ProjectCheckoutPreview = {
  projectId,
  workspaceRoot: "/projects/owned",
  state: "managed",
  ownershipSource: "adopted",
  retention: "keep",
  head: "0123456789abcdef",
  branch: "main",
  repositoryIdentity: null,
  localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
  blockers: [],
  reviewToken: request.reviewToken,
};
const invocation = (access: McpClientCaller["access"]): McpInvocationScope => ({
  environmentId: EnvironmentId.make("checkout-mcp-environment"),
  requestNamespace: "checkout-mcp-test",
  thread: undefined,
  client: { sessionId: "checkout-mcp-session", label: "Test client", access },
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
});
const callerLayer = Layer.mock(ThreadManagementService)({});
const toolkitWith = (service: ProjectCheckoutManagement["Service"]) =>
  ProjectCheckoutToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(projectCheckoutHandlers).pipe(
        Layer.provide(callerLayer),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(ProjectCheckoutManagement, service) as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );
const mutationCases = [
  ["loom_project_checkout_adopt", "read-only"],
  ["loom_project_checkout_adopt", "approval-required"],
  ["loom_project_checkout_adopt", "full-access"],
  ["loom_project_checkout_retention", "read-only"],
  ["loom_project_checkout_retention", "approval-required"],
  ["loom_project_checkout_retention", "full-access"],
] as const;

it.effect.each(mutationCases)(
  "%s requires full access before calling the project service (%s)",
  ([name, access]) =>
    Effect.gen(function* () {
      const mutations: string[] = [];
      const update = (kind: string) =>
        Effect.sync(() => {
          mutations.push(kind);
          return preview;
        });
      const toolkit = yield* toolkitWith({
        preview: () => Effect.succeed(preview),
        adopt: (input, authorize) => {
          expect(input).toEqual(request);
          expect(authorize).toBeDefined();
          return (authorize ?? Effect.die("Adoption must receive the captured caller check")).pipe(
            Effect.andThen(update("adopt")),
          );
        },
        setRetention: (input, authorize) => {
          expect(input).toEqual(request);
          expect(authorize).toBeDefined();
          return (authorize ?? Effect.die("Retention must receive the captured caller check")).pipe(
            Effect.andThen(update("retention")),
          );
        },
      });
      const invoke = toolkit
        .handle(name, request)
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provideService(McpInvocationContext, invocation(access)),
        );
      if (access === "full-access") {
        expect((yield* invoke)[0]).toMatchObject({ isFailure: false, result: preview });
        expect(mutations).toEqual([name === "loom_project_checkout_adopt" ? "adopt" : "retention"]);
      } else {
        expect(yield* invoke.pipe(Effect.flip)).toMatchObject({ code: "capability_denied" });
        expect(mutations).toEqual([]);
      }
    }).pipe(Effect.provide(callerLayer), Effect.scoped),
);

it.effect("read-only MCP clients can inspect a checkout without mutating it", () =>
  Effect.gen(function* () {
    let inspected = false;
    const toolkit = yield* toolkitWith({
      preview: (input) =>
        Effect.sync(() => {
          expect(input).toEqual({ projectId });
          inspected = true;
          return preview;
        }),
      adopt: () => Effect.die("A preview must not adopt the folder"),
      setRetention: () => Effect.die("A preview must not change retention"),
    });
    const result = yield* toolkit
      .handle("loom_project_checkout_preview", { projectId })
      .pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, invocation("read-only")),
      );
    expect(result[0]).toMatchObject({ isFailure: false, result: preview });
    expect(inspected).toBe(true);
  }).pipe(Effect.provide(callerLayer), Effect.scoped),
);
