import {
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthSettingsWriteScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  SKILL_REGISTRY_WS_METHODS as M,
  type SkillRegistryInventory,
} from "@t3tools/contracts/fork";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { makeSkillRegistryRpcHandlers } from "./rpc.ts";
import { SkillRegistryService } from "./SkillRegistryService.ts";

const inventory: SkillRegistryInventory = {
  projectId: null,
  entries: [],
  accounts: [],
  targets: [],
  unavailable: [],
  scanTruncated: false,
  generatedAt: "2026-10-28T00:00:00.000Z",
};
const auth = (scopes: readonly AuthEnvironmentScope[]) =>
  makeForkRpcAuth({
    sessionId: AuthSessionId.make("skills-test"),
    subject: "test",
    method: "bearer-access-token",
    scopes,
  });

it.effect(
  "a read-only client can inspect skills but cannot install or change provider settings",
  () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const handlers = yield* makeSkillRegistryRpcHandlers(auth([AuthFilesystemReadScope])).pipe(
        Effect.provide(
          Layer.mock(SkillRegistryService)({
            sources: Effect.never,
            inventory: () => Effect.succeed(inventory),
            install: () =>
              Effect.sync(() => {
                calls.push("install");
                return [];
              }),
            watchFetch: () =>
              Stream.succeed({ id: "fetch", phase: "ready", source: null, error: null }),
          }),
        ),
      );
      expect(yield* handlers[M.inventory]({ projectId: null })).toEqual(inventory);
      expect(
        yield* Effect.flip(
          handlers[M.install]({
            projectId: null,
            targetId: "target",
            sourceId: "source",
            commit: "commit",
            subpaths: ["sample"],
          }),
        ),
      ).toMatchObject({ requiredScope: AuthFilesystemWriteScope });
      expect(calls).toEqual([]);
      expect(
        yield* handlers[M.watchFetch]({ requestId: "fetch" }).pipe(Stream.runCollect),
      ).toMatchObject([{ phase: "ready" }]);
    }),
);

it.effect("checks the native settings scope separately from skill file access", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const service = Layer.mock(SkillRegistryService)({
      sources: Effect.never,
      install: () =>
        Effect.sync(() => {
          calls.push("install");
          return [];
        }),
    });
    const settingsOnly = yield* makeSkillRegistryRpcHandlers(auth([AuthSettingsWriteScope])).pipe(
      Effect.provide(service),
    );
    expect(
      yield* Effect.flip(
        settingsOnly[M.install]({
          projectId: null,
          targetId: "target",
          sourceId: "source",
          commit: "commit",
          subpaths: ["sample"],
        }),
      ),
    ).toMatchObject({ requiredScope: AuthFilesystemWriteScope });
    const fileAccess = yield* makeSkillRegistryRpcHandlers(auth([AuthFilesystemWriteScope])).pipe(
      Effect.provide(service),
    );
    expect(
      yield* fileAccess[M.install]({
        projectId: null,
        targetId: "target",
        sourceId: "source",
        commit: "commit",
        subpaths: ["sample"],
      }),
    ).toEqual([]);
    expect(calls).toEqual(["install"]);
  }),
);
