import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpInvocationContext, type McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, type ForkServices } from "../ForkRuntime.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
import * as VaultReferences from "./VaultReferences.ts";
import * as SshTransport from "./SshTransport.ts";
import { VaultProfileToolkit, vaultProfileHandlers } from "./profile-mcp.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
it.effect(
  "keeps agent profiles project-local, forbids agent mutation and supports named execution through authenticated MCP",
  () =>
    Effect.gen(function* () {
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            input.authorize.pipe(Effect.as({ exitCode: 0, stdout: "MCP profile" })),
        }),
      );
      yield* f.grant(f.key.destination);
      const projectId = f.state.thread.projectId,
        profileId = yield* f.id;
      const mutation = {
        projectId,
        operationId: yield* f.id,
        expectedRevision: 0,
        change: {
          type: "save" as const,
          profile: {
            id: profileId,
            label: "Agent profile",
            bindings: [{ name: "host", kind: "ssh" as const, itemId: f.itemId, repository: null }],
          },
        },
      };
      const references = yield* VaultReferences.VaultReferences.pipe(
        Effect.provide(VaultReferences.layer),
        Effect.provide(f.context),
      );
      const context = f.context.pipe(
        Context.add(VaultLaunch.VaultLaunch, f.launch),
        Context.add(VaultReferences.VaultReferences, references),
      );
      const toolkit = yield* VaultProfileToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(vaultProfileHandlers).pipe(
            Layer.provide(Layer.succeed(ForkRuntime, context as Context.Context<ForkServices>)),
          ),
        ),
      );
      const scope: McpInvocationScope = {
        environmentId: f.environmentId,
        capabilities: new Set(["orchestration"]),
        issuedAt: 0,
        requestNamespace: "profile",
        client: undefined,
        thread: {
          threadId: f.threadId,
          providerInstanceId: f.state.thread.providerInstanceId!,
          providerSessionId: "test",
        },
      };
      const admin = {
        ...scope,
        thread: undefined,
        client: { sessionId: "admin", access: "full-access" as const, label: "admin" },
      };
      const apply = (caller = scope) =>
        toolkit
          .handle("loom_vault_profiles_apply", mutation)
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(f.context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* apply().pipe(Effect.flip))._tag).toBe("VaultError");
      expect((yield* apply(admin))[0]?.result).toMatchObject({ projectId, revision: 1 });
      const list = yield* toolkit
        .handle("loom_vault_profiles", { projectId: ProjectId.make("other-project") })
        .pipe(
          Effect.flatMap(Stream.runCollect),
          Effect.provide(f.context),
          Effect.provideService(McpInvocationContext, scope),
        );
      expect(list[0]?.result).toMatchObject({ projectId });
      const run = (caller = scope) =>
        toolkit
          .handle("loom_vault_profile_run", {
            profileId,
            binding: "host",
            operation: { kind: "ssh", argv: ["/usr/bin/true"], timeoutMs: 8000 },
          })
          .pipe(
            Effect.flatMap(Stream.runCollect),
            Effect.provide(f.context),
            Effect.provideService(McpInvocationContext, caller),
          );
      expect((yield* run())[0]?.result).toMatchObject({ stdout: "MCP profile" });
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      expect(
        (yield* run({
          ...scope,
          thread: { ...scope.thread!, providerInstanceId: ProviderInstanceId.make("wrong") },
        }).pipe(Effect.flip))._tag,
      ).toBe("OrchestratorMcpFailure");
      expect(
        (yield* apply({ ...admin, client: { ...admin.client, access: "read-only" } }).pipe(
          Effect.flip,
        ))._tag,
      ).toBe("OrchestratorMcpFailure");
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(NodeServices.layer, memoryVault))),
);
