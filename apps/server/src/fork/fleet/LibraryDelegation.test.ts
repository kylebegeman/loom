import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type { LibraryProject, LibraryResolvedBinding } from "@t3tools/contracts/fork";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { McpThreadInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as PeerForwarding from "../../peer/PeerForwarding.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as LibraryPublisher from "../project-library/LibraryPublisher.ts";
import * as LibraryWorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";
import { launchLibraryRemoteTask, resolveLibraryRemotePlacement } from "./LibraryDelegation.ts";

import type * as Tool from "effect/ai/Tool";
import { ProjectToolkit } from "../../mcp/toolkits/project/tools.ts";
import { OrchestratorToolkit } from "../../mcp/toolkits/orchestrator/tools.ts";
import { ProjectLibraryToolkit } from "../project-library/tools.ts";

const decoders: Readonly<
  Record<string, (value: unknown) => Effect.Effect<unknown, Schema.SchemaError>>
> = {
  loom_library_binding_resolve: Schema.decodeUnknownEffect(
    ProjectLibraryToolkit.tools.loom_library_binding_resolve.successSchema,
  ),
  loom_library_profile_readiness: Schema.decodeUnknownEffect(
    ProjectLibraryToolkit.tools.loom_library_profile_readiness.successSchema,
  ),
  loom_library_thread_bind: Schema.decodeUnknownEffect(
    ProjectLibraryToolkit.tools.loom_library_thread_bind.successSchema,
  ),
  t3_thread_launch: Schema.decodeUnknownEffect(ProjectToolkit.tools.t3_thread_launch.successSchema),
  t3_thread_send: Schema.decodeUnknownEffect(
    OrchestratorToolkit.tools.t3_thread_send.successSchema,
  ),
};

const here = EnvironmentId.make("laptop");
const there = EnvironmentId.make("studio");
const localProject = ProjectId.make("library-copy:loom:app");
const instanceId = ProviderInstanceId.make("codex");
const scope: McpThreadInvocationScope = {
  environmentId: here,
  requestNamespace: "provider:parent",
  thread: {
    threadId: ThreadId.make("parent"),
    providerSessionId: "session",
    providerInstanceId: instanceId,
  },
  capabilities: new Set(["orchestration"]),
  client: undefined,
  issuedAt: 1,
};
const project: LibraryProject = {
  id: "loom",
  title: "Loom",
  brief: "Keep the fork",
  revision: 3,
  archived: false,
  resources: [
    {
      id: "app",
      title: "App",
      relativePath: ".",
      remoteUrl: "https://github.com/acme/loom.git",
      defaultBranch: "main",
    },
  ],
  profile: { requiredTools: [{ id: "node", minimumVersion: "26" }] },
  createdAt: "2026-10-28T00:00:00.000Z",
  updatedAt: "2026-10-28T00:00:00.000Z",
};
const resolved: LibraryResolvedBinding = {
  localProjectId: localProject,
  cwd: "/studio/loom",
  repositoryPaths: ["/studio/loom"],
  binding: {
    projectId: project.id,
    projectRevision: 3,
    workingCopyId: "studio-copy",
    environmentId: there,
    resourceIds: ["app"],
  },
};

function setup(
  options: { readonly responses?: Record<string, unknown>; readonly bound?: boolean } = {},
) {
  const calls: Array<{ readonly tool: string; readonly input: unknown }> = [];
  const responses: Record<string, unknown> = {
    loom_library_binding_resolve: resolved,
    loom_library_profile_readiness: {
      projectId: project.id,
      environmentId: there,
      checks: [{ id: "node", label: "Node", status: "ok", version: "26.12.1" }],
      secrets: [],
      checkedAt: "2026-10-28T00:00:00.000Z",
    },
    t3_thread_launch: {
      threadId: ThreadId.make("remote-child"),
      projectId: localProject,
      modelSelection: { instanceId, model: "model" },
      runId: null,
      status: null,
    },
    loom_library_thread_bind: resolved,
    t3_thread_send: {
      threadId: ThreadId.make("remote-child"),
      messageId: MessageId.make("prompt"),
      runId: RunId.make("run"),
      status: "running",
      delivery: "started",
    },
    ...options.responses,
  };
  const publisher = Layer.mock(LibraryPublisher.LibraryPublisher)({
    enabled: true,
    launchCandidates: () =>
      Effect.succeed({
        projectId: project.id,
        candidates: [
          {
            kind: "copy",
            environmentId: there,
            label: "Studio",
            online: true,
            copyId: "studio-copy",
            freshness: "up-to-date",
            lastUsedAt: null,
            reasons: ["up to date"],
            preselected: true,
          },
        ],
      }),
  });
  const layer = Layer.mergeAll(
    Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({
      getBinding: () =>
        Effect.succeed(
          options.bound === false
            ? null
            : {
                ...resolved,
                binding: { ...resolved.binding, environmentId: here, workingCopyId: "laptop-copy" },
              },
        ),
      getBoundProject: () => Effect.succeed(project),
    }),
    Layer.mock(PeerForwarding.PeerForwarding)({
      call: (_scope, tool, _environmentId, input) => {
        calls.push({ tool: tool.name, input });
        const decode = decoders[tool.name as keyof typeof decoders];
        return (
          decode === undefined
            ? Effect.die(`Unexpected tool ${tool.name}`)
            : decode(responses[tool.name]).pipe(Effect.orDie)
        ) as Effect.Effect<Tool.Success<typeof tool>>;
      },
    }),
  );
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const runtime = yield* Layer.build(publisher);
      return yield* effect.pipe(
        Effect.provide(layer),
        Effect.provideService(ForkRuntime, runtime as Context.Context<ForkServices>),
      );
    });
  return { calls, run };
}

it.effect("resolves the pinned Library component to its exact destination local project", () => {
  const f = setup();
  return f.run(
    Effect.gen(function* () {
      const placement = yield* resolveLibraryRemotePlacement(scope, there, undefined);
      expect(placement).toEqual({ project, binding: resolved.binding, projectId: localProject });
      expect(f.calls.map((call) => call.tool)).toEqual([
        "loom_library_binding_resolve",
        "loom_library_profile_readiness",
      ]);
    }),
  );
});

it.effect("refuses a vanilla checkout even if it has the same canonical upstream", () => {
  const f = setup();
  return f.run(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveLibraryRemotePlacement(scope, there, ProjectId.make("vanilla-t3")),
      );
      expect(error.code).toBe("target_required");
      expect(f.calls.some((call) => call.tool === "t3_thread_launch")).toBe(false);
    }),
  );
});

it.effect("never changes an explicitly chosen host to one with a copy", () => {
  const f = setup();
  return f.run(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveLibraryRemotePlacement(scope, EnvironmentId.make("other"), undefined),
      );
      expect(error.code).toBe("target_required");
      expect(f.calls).toEqual([]);
    }),
  );
});

it.effect("refuses a destination that changes component scope", () => {
  const f = setup({
    responses: {
      loom_library_binding_resolve: {
        ...resolved,
        binding: { ...resolved.binding, resourceIds: [] },
      },
    },
  });
  return f.run(
    Effect.gen(function* () {
      const error = yield* Effect.flip(resolveLibraryRemotePlacement(scope, there, undefined));
      expect(error.code).toBe("target_required");
    }),
  );
});

it.effect.each(["missing", "outdated", "unknown"])("refuses a %s required tool", (status) => {
  const f = setup({
    responses: {
      loom_library_profile_readiness: {
        projectId: project.id,
        environmentId: there,
        checks: [{ id: "node", label: "Node", status }],
        secrets: [],
        checkedAt: "2026-10-28T00:00:00.000Z",
      },
    },
  });
  return f.run(
    Effect.gen(function* () {
      const error = yield* Effect.flip(resolveLibraryRemotePlacement(scope, there, undefined));
      expect(error.code).toBe("target_required");
    }),
  );
});

it.effect("leaves ordinary non-Library delegations to upstream", () => {
  const f = setup({ bound: false });
  return f.run(
    Effect.gen(function* () {
      expect(yield* resolveLibraryRemotePlacement(scope, there, undefined)).toBeNull();
      expect(f.calls).toEqual([]);
    }),
  );
});

it.effect("binds an idle child before dispatch and preserves retry keys and mode ceilings", () => {
  const f = setup();
  return f.run(
    Effect.gen(function* () {
      const result = yield* launchLibraryRemoteTask(
        scope,
        there,
        { project, binding: resolved.binding, projectId: localProject },
        {
          projectId: localProject,
          title: "Check Loom",
          message: "Inspect this fork",
          clientRequestId: "delegate:parent:1",
          runtimeMode: "approval-required",
          interactionMode: "plan",
        },
      );
      expect(f.calls.map((call) => call.tool)).toEqual([
        "t3_thread_launch",
        "loom_library_thread_bind",
        "t3_thread_send",
      ]);
      expect(f.calls[0]?.input).toMatchObject({
        projectId: localProject,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        clientRequestId: "delegate:parent:1",
      });
      expect(f.calls[0]?.input).not.toHaveProperty("message");
      expect(f.calls[1]?.input).toMatchObject({
        binding: resolved.binding,
        project,
        threadId: "remote-child",
      });
      expect(f.calls[2]?.input).toMatchObject({
        message: "Inspect this fork",
        clientRequestId: "delegate:parent:1:message",
      });
      expect(result.runId).toBe("run");
    }),
  );
});
