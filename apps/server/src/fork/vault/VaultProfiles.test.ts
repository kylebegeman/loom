import { vaultProfileRequirements } from "@t3tools/contracts/fork";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, RunId } from "@t3tools/contracts";
import {
  VaultError,
  vaultGitDestination,
  type VaultProfileDefinition,
  type VaultProfileMutation,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SshTransport from "./SshTransport.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
const dependencies = Layer.merge(NodeServices.layer, memoryVault);
const transport = Layer.succeed(SshTransport.SshTransport, {
  execute: (input) => input.authorize.pipe(Effect.as({ exitCode: 0, stdout: "profile ok" })),
});
const fixture = Effect.gen(function* () {
  const f = yield* launchFixture(transport);
  const projectId = f.state.thread.projectId;
  const definition: VaultProfileDefinition = {
    id: yield* f.id,
    label: "Development",
    bindings: [{ name: "server", kind: "ssh", itemId: f.itemId, repository: null }],
  };
  const apply = (change: VaultProfileMutation["change"]) =>
    Effect.gen(function* () {
      const current = yield* f.profiles.list(projectId);
      return yield* f.profiles.apply(
        { projectId, operationId: yield* f.id, expectedRevision: current.revision, change },
        "admin",
      );
    });
  return { ...f, projectId, definition, apply };
});
it.effect("protects profile revisions, retries, project boundaries and reversible defaults", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    const input = {
      projectId: f.projectId,
      operationId: yield* f.id,
      expectedRevision: 0,
      change: { type: "save" as const, profile: f.definition },
    };
    expect((yield* f.profiles.apply(input, "admin")).revision).toBe(1);
    expect((yield* f.profiles.apply(input, "admin")).revision).toBe(1);
    expect((yield* f.profiles.apply(input, "other").pipe(Effect.flip)).reason).toBe("conflict");
    expect(
      (yield* f.profiles.apply({ ...input, operationId: yield* f.id }, "admin").pipe(Effect.flip))
        .reason,
    ).toBe("conflict");
    expect((yield* f.profiles.list(ProjectId.make("other-project"))).profiles).toEqual([]);
    yield* f.apply({ type: "activate", id: f.definition.id });
    expect(
      (yield* f.apply({ type: "state", id: f.definition.id, state: "archived" })).activeProfileId,
    ).toBeNull();
    expect((yield* f.apply({ type: "save", profile: f.definition }).pipe(Effect.flip)).reason).toBe(
      "archived",
    );
    expect(
      (yield* f.apply({ type: "state", id: f.definition.id, state: "active" })).activeProfileId,
    ).toBeNull();
    const clone = { ...f.definition, id: yield* f.id, label: "Staging" };
    expect((yield* f.apply({ type: "save", profile: clone })).profiles).toHaveLength(2);
    yield* f.apply({ type: "activate", id: clone.id });
    expect((yield* f.apply({ type: "activate", id: null })).activeProfileId).toBeNull();
    let checks = 0;
    const current = yield* f.profiles.list(f.projectId);
    expect(
      (yield* f.profiles
        .apply(
          {
            projectId: f.projectId,
            operationId: yield* f.id,
            expectedRevision: current.revision,
            change: { type: "activate", id: clone.id },
          },
          "admin",
          Effect.suspend(() =>
            ++checks === 1 ? Effect.void : Effect.fail(new VaultError({ reason: "denied" })),
          ),
        )
        .pipe(Effect.flip)).reason,
    ).toBe("denied");
    expect((yield* f.profiles.list(f.projectId)).revision).toBe(current.revision);
  }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "previews missing, unavailable, untrusted and denied requirements without treating host checks as authorization",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const preview = (profile = f.definition, threadId: typeof f.threadId | null = f.threadId) =>
        f.profiles.preview({ projectId: f.projectId, profile, threadId });
      expect((yield* preview()).bindings[0]?.state).toBe("denied");
      expect((yield* preview(f.definition, null)).bindings[0]?.state).toBe("unchecked");
      yield* f.grant(f.key.destination);
      expect((yield* preview()).ready).toBe(true);
      expect(
        (yield* preview({
          ...f.definition,
          bindings: [{ ...f.definition.bindings[0]!, itemId: null }],
        })).bindings[0]?.state,
      ).toBe("missing");
      expect(
        (yield* preview({
          ...f.definition,
          bindings: [{ ...f.definition.bindings[0]!, itemId: "0".repeat(32) }],
        })).bindings[0]?.state,
      ).toBe("unavailable");
      const untrustedId = yield* f.id;
      yield* f.ssh.generate(
        {
          id: untrustedId,
          operationId: yield* f.id,
          label: "Untrusted",
          target: { ...f.key.target, hostKey: null },
        },
        "admin",
        Effect.void,
      );
      expect(
        (yield* preview(
          { ...f.definition, bindings: [{ ...f.definition.bindings[0]!, itemId: untrustedId }] },
          null,
        )).bindings[0]?.state,
      ).toBe("untrusted");
      expect(
        (yield* f.profiles
          .preview({
            projectId: ProjectId.make("another"),
            profile: f.definition,
            threadId: f.threadId,
          })
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      const partial = {
        ...f.definition,
        bindings: [{ name: "repo", kind: "git" as const, itemId: null, repository: null }],
      };
      expect(
        (yield* f.apply({ type: "save", profile: partial })).profiles[0]?.bindings[0]?.itemId,
      ).toBeNull();
      yield* f.apply({ type: "activate", id: partial.id });
      expect((yield* f.profiles.resolve(f.threadId, null).pipe(Effect.flip)).reason).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "durably pins run configuration across reconstruction and edits, while revocation and key version changes still block use",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.grant(f.key.destination);
      yield* f.apply({ type: "save", profile: f.definition });
      yield* f.apply({ type: "activate", id: f.definition.id });
      const pinned = yield* f.profiles.resolve(f.threadId, null);
      yield* f.apply({
        type: "save",
        profile: {
          ...f.definition,
          label: "Edited",
          bindings: [{ ...f.definition.bindings[0]!, itemId: null }],
        },
      });
      yield* f.apply({ type: "activate", id: null });
      const restored = yield* VaultProfiles.VaultProfiles.pipe(
        Effect.provide(VaultProfiles.layer),
        Effect.provide(f.context),
      );
      expect(yield* restored.resolve(f.threadId, null)).toEqual(pinned);
      expect((yield* restored.resolve(f.threadId, yield* f.id).pipe(Effect.flip)).reason).toBe(
        "conflict",
      );
      const result = yield* f.launch.profile(
        {
          profileId: null,
          binding: "server",
          operation: { kind: "ssh", argv: ["/usr/bin/true"], timeoutMs: 8000 },
        },
        f.threadId,
      );
      expect(result.stdout).toBe("profile ok");
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 1,
          change: { type: "state", id: f.grantId, state: "suspended" },
        },
        "admin",
      );
      expect((yield* restored.resolve(f.threadId, null).pipe(Effect.flip)).reason).toBe("denied");
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 2,
          change: { type: "state", id: f.grantId, state: "active" },
        },
        "admin",
      );
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
      expect((yield* restored.resolve(f.threadId, null).pipe(Effect.flip)).reason).toBe("conflict");
      f.state.thread = { ...f.state.thread, activeRunId: RunId.make("next-run") };
      expect((yield* restored.resolve(f.threadId, null).pipe(Effect.flip)).reason).toBe(
        "not-found",
      );
      yield* f.apply({ type: "save", profile: { ...f.definition, label: "Next run" } });
      yield* f.apply({ type: "activate", id: f.definition.id });
      expect((yield* restored.resolve(f.threadId, null)).bindings[0]?.version).toBe(2);
      yield* f.apply({ type: "state", id: f.definition.id, state: "archived" });
      expect((yield* restored.resolve(f.threadId, null).pipe(Effect.flip)).reason).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
it.effect(
  "executes named Git bindings with exact repository grants and rejects archive before signing",
  () =>
    Effect.gen(function* () {
      let beforeSign: Effect.Effect<void, VaultError> = Effect.void;
      const f = yield* launchFixture(
        Layer.succeed(SshTransport.SshTransport, {
          execute: (input) =>
            beforeSign.pipe(
              Effect.andThen(input.authorize),
              Effect.as({ exitCode: 0, stdout: "git ok" }),
            ),
        }),
      );
      const projectId = f.state.thread.projectId,
        profile: VaultProfileDefinition = {
          id: yield* f.id,
          label: "Git",
          bindings: [
            { name: "source", kind: "git", itemId: f.itemId, repository: "team/repo.git" },
          ],
        };
      yield* f.grant(vaultGitDestination(f.key.target, "team/repo.git"));
      yield* f.profiles.apply(
        {
          projectId,
          operationId: yield* f.id,
          expectedRevision: 0,
          change: { type: "save", profile },
        },
        "admin",
      );
      const input = {
        profileId: profile.id,
        binding: "source",
        operation: { kind: "git" as const, action: "ls-remote" as const, timeoutMs: 8000 },
      };
      expect((yield* f.launch.profile(input, f.threadId)).stdout).toBe("git ok");
      expect(
        (yield* f.launch.profile({ ...input, binding: "missing" }, f.threadId).pipe(Effect.flip))
          .reason,
      ).toBe("invalid-operation");
      beforeSign = f.profiles
        .apply(
          {
            projectId,
            operationId: yield* f.id,
            expectedRevision: 1,
            change: { type: "state", id: profile.id, state: "archived" },
          },
          "admin",
        )
        .pipe(Effect.asVoid);
      expect((yield* f.launch.profile(input, f.threadId).pipe(Effect.flip)).reason).toBe("denied");
      expect(yield* f.workloads.list(f.threadId)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);

it.effect(
  "imports requirements as a fresh unbound profile without overwriting bindings or selecting a default",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* f.apply({ type: "save", profile: f.definition });
      const id = yield* f.id;
      const declaration = vaultProfileRequirements(f.definition);
      const imported = yield* f.apply({ type: "import", id, declaration });
      expect(imported.activeProfileId).toBeNull();
      expect(imported.profiles.find((p) => p.id === id)?.bindings).toEqual([
        { name: "server", kind: "ssh", itemId: null, repository: null },
      ]);
      expect(
        (yield* f.apply({ type: "import", id: f.definition.id, declaration }).pipe(Effect.flip))
          .reason,
      ).toBe("conflict");
      expect((yield* f.profiles.list(f.projectId)).profiles[0]?.bindings[0]?.itemId).toBe(f.itemId);
      const importedProfile = imported.profiles.find((p) => p.id === id)!;
      expect(
        (yield* f.profiles.preview({
          projectId: f.projectId,
          profile: importedProfile,
          threadId: f.threadId,
        })).bindings[0]?.state,
      ).toBe("missing");
      yield* f.apply({
        type: "save",
        profile: {
          ...importedProfile,
          bindings: [{ ...importedProfile.bindings[0]!, itemId: f.itemId }],
        },
      });
      yield* f.grant(f.key.destination);
      expect((yield* f.profiles.resolve(f.threadId, id)).bindings[0]?.itemId).toBe(f.itemId);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
);
