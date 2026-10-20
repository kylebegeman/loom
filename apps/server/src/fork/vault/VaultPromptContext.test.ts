import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { RunId } from "@t3tools/contracts";
import { vaultPromptLink } from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SshTransport from "./SshTransport.ts";
import * as VaultReferences from "./VaultReferences.ts";
import * as VaultPromptContext from "./VaultPromptContext.ts";
import { launchFixture, memoryVault } from "./VaultLaunch.testkit.ts";
const deps = Layer.merge(NodeServices.layer, memoryVault);
const fixture = Effect.gen(function* () {
  const f = yield* launchFixture(
    Layer.succeed(SshTransport.SshTransport, {
      execute: (input) => input.authorize.pipe(Effect.as({ exitCode: 0, stdout: "ok" })),
    }),
  );
  const refs = yield* VaultReferences.VaultReferences.pipe(
    Effect.provide(VaultReferences.layer),
    Effect.provide(f.context),
  );
  const context = Context.add(f.context, VaultReferences.VaultReferences, refs);
  yield* Layer.build(VaultPromptContext.layer).pipe(Effect.provide(context));
  const profile = {
    id: yield* f.id,
    label: "Reviewed environment",
    bindings: [{ name: "server", kind: "ssh" as const, itemId: f.itemId, repository: null }],
  };
  const projectId = f.state.thread.projectId;
  yield* f.profiles.apply(
    { projectId, operationId: yield* f.id, expectedRevision: 0, change: { type: "save", profile } },
    "admin",
  );
  const input = {
    threadId: f.threadId,
    runId: f.state.thread.activeRunId!,
    text: vaultPromptLink(
      { kind: "profile", environmentId: f.environmentId, id: profile.id, version: 1 },
      profile.label,
    ),
  };
  const prepare = (text = input.text) =>
    VaultPromptContext.applyVaultPromptContext({
      ...input,
      runId: f.state.thread.activeRunId!,
      text,
    }).pipe(Effect.provide(context));
  return { ...f, profile, projectId, input, prepare };
});
it.effect(
  "requires no Vault runtime or network for ordinary text, and fails closed for explicit links without one",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      yield* VaultPromptContext.applyVaultPromptContext({
        ...f.input,
        text: "No Vault requirement",
      });
      expect(
        (yield* VaultPromptContext.applyVaultPromptContext(f.input).pipe(Effect.flip)).reason,
      ).toBe("unavailable");
      expect(
        (yield* f
          .prepare(f.input.text.replace(f.environmentId, "wrong-computer"))
          .pipe(Effect.flip)).reason,
      ).toBe("wrong-environment");
      expect((yield* f.prepare(`${f.input.text}\n${f.input.text}`).pipe(Effect.flip)).reason).toBe(
        "invalid-links",
      );
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "preflights an interactive or scheduled prompt before use, preserving run pins while checking revision and revocation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      expect((yield* f.prepare().pipe(Effect.flip)).reason).toBe("profile-blocked");
      yield* f.grant(f.key.destination);
      yield* f.prepare();
      expect((yield* f.profiles.resolve(f.threadId, null)).profileId).toBe(f.profile.id);
      yield* f.profiles.apply(
        {
          projectId: f.projectId,
          operationId: yield* f.id,
          expectedRevision: 1,
          change: { type: "save", profile: { ...f.profile, label: "Later profile" } },
        },
        "admin",
      );
      yield* f.prepare();
      f.state.thread = { ...f.state.thread, activeRunId: RunId.make("scheduled-next-firing") };
      expect((yield* f.prepare().pipe(Effect.flip)).reason).toBe("profile-changed");
      const current = vaultPromptLink(
        { kind: "profile", environmentId: f.environmentId, id: f.profile.id, version: 2 },
        "Untrusted display label ignored",
      );
      yield* f.prepare(current);
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 1,
          change: { type: "state", id: f.grantId, state: "revoked" },
        },
        "admin",
      );
      expect((yield* f.prepare(current).pipe(Effect.flip)).reason).toBe("profile-blocked");
      expect(
        (yield* f.profiles
          .prepare(f.threadId, f.profile.id, 2, RunId.make("wrong-run"))
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
it.effect(
  "checks active references with inspect grants, never reveals values, and rejects archived references",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const text = vaultPromptLink(
        { kind: "reference", environmentId: f.environmentId, id: f.itemId },
        "A caller cannot grant itself access",
      );
      expect((yield* f.prepare(text).pipe(Effect.flip)).reason).toBe("reference-blocked");
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: 0,
          change: {
            type: "save",
            grant: {
              id: f.grantId,
              label: "Inspect only",
              principal: { kind: "project", id: f.projectId },
              itemIds: [f.itemId],
              actions: ["inspect"],
              projectId: null,
              destination: null,
              notBefore: 0,
              expiresAt: null,
              parentId: null,
            },
          },
        },
        "admin",
      );
      yield* f.prepare(text);
      yield* f.core.change(
        { id: f.itemId, operationId: yield* f.id, expectedVersion: 1, action: "archive" },
        "admin",
      );
      expect((yield* f.prepare(text).pipe(Effect.flip)).reason).toBe("reference-blocked");
    }).pipe(Effect.scoped, Effect.provide(deps)),
);
