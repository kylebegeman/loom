import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ProjectResourcesSnapshot } from "@t3tools/contracts/fork";
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
import { ProjectResources } from "../../project/ProjectResources.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { ProjectResourcesToolkit, projectResourcesHandlers } from "./mcp.ts";

const projectId = ProjectId.make("resources-mcp-project");
const resource = {
  id: "guide",
  kind: "link" as const,
  title: "Guide",
  url: "https://example.test/guide",
};
const snapshot: ProjectResourcesSnapshot = { projectId, revision: 1, resources: [resource] };
const upsertRequest = { projectId, expectedRevision: 0, resource };
const removeRequest = { projectId, expectedRevision: 1, resourceId: resource.id };
const invocation = (access: McpClientCaller["access"]): McpInvocationScope => ({
  environmentId: EnvironmentId.make("resources-mcp-host"),
  requestNamespace: "resources-mcp-test",
  thread: undefined,
  client: { sessionId: "resources-mcp-session", label: "Test client", access },
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
});
const callerLayer = Layer.mock(ThreadManagementService)({});
const toolkitWith = (service: ProjectResources["Service"]) =>
  ProjectResourcesToolkit.pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(projectResourcesHandlers).pipe(
        Layer.provide(callerLayer),
        Layer.provide(
          Layer.succeed(
            ForkRuntime,
            Context.make(ProjectResources, service) as Context.Context<ForkServices>,
          ),
        ),
      ),
    ),
  );

it.effect.each([
  ["loom_project_resource_upsert", "read-only"],
  ["loom_project_resource_upsert", "approval-required"],
  ["loom_project_resource_upsert", "full-access"],
  ["loom_project_resource_remove", "read-only"],
  ["loom_project_resource_remove", "approval-required"],
  ["loom_project_resource_remove", "full-access"],
] as const)("%s requires full access before changing metadata (%s)", ([name, access]) =>
  Effect.gen(function* () {
    const mutations: string[] = [];
    const toolkit = yield* toolkitWith({
      get: () => Effect.succeed(snapshot),
      upsert: (input) =>
        Effect.sync(() => {
          expect(input).toEqual(upsertRequest);
          mutations.push("upsert");
          return snapshot;
        }),
      remove: (input) =>
        Effect.sync(() => {
          expect(input).toEqual(removeRequest);
          mutations.push("remove");
          return snapshot;
        }),
    });
    const invoke = toolkit
      .handle(name, name === "loom_project_resource_upsert" ? upsertRequest : removeRequest)
      .pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, invocation(access)),
      );
    if (access === "full-access") {
      expect((yield* invoke)[0]).toMatchObject({ isFailure: false, result: snapshot });
      expect(mutations).toEqual([name === "loom_project_resource_upsert" ? "upsert" : "remove"]);
    } else {
      expect(yield* invoke.pipe(Effect.flip)).toMatchObject({ code: "capability_denied" });
      expect(mutations).toEqual([]);
    }
  }).pipe(Effect.provide(callerLayer), Effect.scoped),
);
it.effect("read-only clients can read resources without changing metadata", () =>
  Effect.gen(function* () {
    const toolkit = yield* toolkitWith({
      get: (input) => {
        expect(input).toEqual({ projectId });
        return Effect.succeed(snapshot);
      },
      upsert: () => Effect.die("Reading resources must not add one"),
      remove: () => Effect.die("Reading resources must not remove one"),
    });
    const result = yield* toolkit
      .handle("loom_project_resources_get", { projectId })
      .pipe(
        Effect.flatMap(Stream.runCollect),
        Effect.provideService(McpInvocationContext, invocation("read-only")),
      );
    expect(result[0]).toMatchObject({ isFailure: false, result: snapshot });
  }).pipe(Effect.provide(callerLayer), Effect.scoped),
);
