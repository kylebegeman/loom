import { expect, it } from "@effect/vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { ProviderInstanceId, TurnItemId, type OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as Library from "@t3tools/contracts/fork";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Tool } from "effect/ai";
import * as Stream from "effect/Stream";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import { archiveFor, resource, source, threadId } from "./Library.testkit.ts";
import * as Publisher from "./LibraryPublisher.ts";
import { ProjectLibraryToolkit, projectLibraryHandlers } from "./mcp.ts";

const project = {
  id: "project",
  title: "Project",
  brief: "Keep the complete project context.",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T00:00:00.000Z",
} satisfies Library.LibraryProject;
const launch = {
  project,
  binding: {
    projectId: project.id,
    projectRevision: 1,
    workingCopyId: "copy",
    environmentId: source,
    resourceIds: [resource.id],
  },
  threadId,
  title: "Continue the work",
  modelSelection: { instanceId: "codex", model: "gpt-6.1" },
  runtimeMode: "full-access",
  interactionMode: "default",
};
const originalParameters = Schema.Struct({
  operationId: Library.LibraryRequestId,
  request: Schema.Struct({ kind: Schema.Literal("launch"), input: Library.LibraryLaunchOperation }),
});
const operationTool = ProjectLibraryToolkit.tools.loom_library_operation_run;
// Production registration decodes the canonical JSON codec, including null for optional fields.
const decodeOriginal = Schema.decodeUnknownEffect(Schema.toCodecJson(originalParameters));
const decodeAdvertised = Schema.decodeUnknownEffect(
  Schema.toCodecJson(operationTool.parametersSchema),
);
const requestFor = (input: unknown) => ({
  operationId: " launch-operation ",
  request: { kind: "launch", input },
});
const validateInput = new AjvJsonSchemaValidator().getValidator(Tool.getJsonSchema(operationTool));

it.effect.each([
  { name: "minimal project", input: launch },
  {
    name: "complete project, legacy model options and continuation",
    input: {
      ...launch,
      project: {
        ...project,
        id: " project ",
        title: " Project ",
        color: "plum",
        profile: {
          connectionNames: ["personal-vps"],
          scripts: [
            {
              id: "check",
              name: "Check",
              command: "vp test",
              icon: "test",
              runOnWorktreeCreate: false,
            },
          ],
          defaultModelSelection: {
            provider: "claude",
            model: "custom-model",
            options: { effort: "max" },
          },
          requiredTools: [{ id: "future-tool", minimumVersion: "3.12" }],
          secretNames: ["EXAMPLE_TOKEN"],
          preferredEnvironmentIds: [source],
          allowMini: false,
          briefSuggestions: "ask",
        },
        futureField: "ignored by the original decoder",
      },
      binding: {
        ...launch.binding,
        continuationOf: { environmentId: source, threadId, sequence: 7 },
      },
      modelSelection: {
        provider: "codex",
        model: "custom-model",
        options: { reasoningEffort: "max" },
      },
      keepOnComputer: false,
    },
  },
  {
    name: "files reserved for the launch",
    input: {
      ...launch,
      binding: { ...launch.binding, workingCopyId: "files-request" },
      workspace: "worktree",
      files: {
        requestId: "files-request",
        project: { ...project, color: null, futureField: "ignored by the original decoder" },
        rootPath: "/work/new-copy",
        strategy: "clone",
        resourceIds: [resource.id],
      },
    },
  },
  {
    name: "null optional project fields",
    input: {
      ...launch,
      project: { ...project, color: null, profile: null },
      keepOnComputer: null,
    },
  },
  {
    name: "null optional fields inside a profile",
    input: {
      ...launch,
      project: {
        ...project,
        profile: {
          scripts: null,
          defaultModelSelection: null,
          requiredTools: [{ id: "node", minimumVersion: null }],
          allowMini: null,
        },
      },
      keepOnComputer: true,
    },
  },
])("preserves launch decoding for $name", ({ input }) =>
  Effect.gen(function* () {
    const request = requestFor(input);
    const expected = yield* decodeOriginal(request);
    expect(yield* decodeAdvertised(request)).toEqual(expected);
    expect(validateInput(request).valid).toBe(true);
  }),
);

it.effect.each([
  { name: "missing project", input: { ...launch, project: undefined } },
  { name: "null project", input: { ...launch, project: null } },
  { name: "invalid revision", input: { ...launch, project: { ...project, revision: 0 } } },
  {
    name: "invalid nested tool",
    input: { ...launch, project: { ...project, profile: { requiredTools: [{ id: "BAD TOOL" }] } } },
  },
  { name: "blank title", input: { ...launch, title: " " } },
  { name: "missing model", input: { ...launch, modelSelection: { instanceId: "codex" } } },
])("retains full launch validation for $name", ({ input }) =>
  Effect.gen(function* () {
    const request = requestFor(input);
    expect((yield* decodeOriginal(request).pipe(Effect.result))._tag).toBe("Failure");
    expect((yield* decodeAdvertised(request).pipe(Effect.result))._tag).toBe("Failure");
  }),
);

const historyTool = ProjectLibraryToolkit.tools.loom_library_history;
const encodeOriginalArchive = Schema.encodeEffect(Schema.toCodecJson(Library.LibraryThreadArchive));
const encodeUnknownOriginalArchive = Schema.encodeUnknownEffect(Library.LibraryThreadArchive);
const encodeUnknownAdvertisedArchive = Schema.encodeUnknownEffect(historyTool.successSchema);
const isJson = Schema.is(Schema.Json);

it.effect.each([false, true])(
  "keeps encoded history bytes unchanged with optional context %s",
  (withContext) =>
    Effect.gen(function* () {
      const original = yield* archiveFor(project);
      const item = {
        id: TurnItemId.make("tool-result"),
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: 0,
        status: "completed",
        title: null,
        startedAt: original.projection.updatedAt,
        completedAt: original.projection.updatedAt,
        updatedAt: original.projection.updatedAt,
        type: "dynamic_tool",
        toolName: "example",
        input: { nested: ["café", null, { enabled: true }] },
        output: { nested: [1, { text: "saved result" }] },
      } satisfies OrchestrationV2TurnItem;
      const archive: Library.LibraryThreadArchive = {
        ...original,
        ...(withContext
          ? {
              window: { offset: 3, totalItems: 10, hasMore: true, nextOffset: 5 },
              context: {
                ...project,
                profile: {
                  defaultModelSelection: {
                    instanceId: ProviderInstanceId.make("codex"),
                    model: "gpt-6.1",
                  },
                },
              },
            }
          : {}),
        projection: {
          ...original.projection,
          turnItems: [item],
          visibleTurnItems: [
            {
              position: 0,
              visibility: "local",
              sourceThreadId: threadId,
              sourceItemId: item.id,
              item,
            },
          ],
        },
      };
      const expected = JSON.stringify(yield* encodeOriginalArchive(archive));
      const runtime = yield* Layer.build(
        Layer.mock(Publisher.LibraryPublisher)({
          enabled: true,
          history: (input) => {
            expect(input).toEqual({ id: "archive-thread", offset: 0, limit: 50 });
            return Effect.succeed(archive);
          },
        }),
      );
      const toolkit = yield* ProjectLibraryToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(projectLibraryHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, runtime as Context.Context<ForkServices>)),
          ),
        ),
      );
      const results = yield* toolkit
        .handle("loom_library_history", { id: "archive-thread" })
        .pipe(Effect.flatMap(Stream.runCollect));
      expect(results).toHaveLength(1);
      expect(results[0]!.isFailure).toBe(false);
      // MCP rejects structured content that is not plain JSON.
      expect(isJson(results[0]!.encodedResult)).toBe(true);
      const encoded = JSON.stringify(results[0]!.encodedResult);
      expect(encoded).toBe(expected);
      const advertised = Tool.getJsonSchemaFromSchema(historyTool.successSchema);
      expect(new AjvJsonSchemaValidator().getValidator(advertised)(JSON.parse(encoded)).valid).toBe(
        true,
      );
    }).pipe(Effect.scoped),
);

it.effect("still validates the full history projection before encoding", () =>
  Effect.gen(function* () {
    const archive = yield* archiveFor(project);
    const invalid = {
      ...archive,
      projection: {
        ...archive.projection,
        messages: [{ ...archive.projection.messages[0], text: 42 }],
      },
    };
    expect((yield* encodeUnknownOriginalArchive(invalid).pipe(Effect.result))._tag).toBe("Failure");
    expect((yield* encodeUnknownAdvertisedArchive(invalid).pipe(Effect.result))._tag).toBe(
      "Failure",
    );
  }),
);

it("advertises compact Library schemas with reference-free inputs", () => {
  const input = JSON.stringify(Tool.getJsonSchema(operationTool));
  expect(input).not.toContain('"$ref"');
  expect(Buffer.byteLength(input)).toBeLessThan(3_000);
  expect(
    Buffer.byteLength(JSON.stringify(Tool.getJsonSchemaFromSchema(historyTool.successSchema))),
  ).toBeLessThan(9_000);
});
