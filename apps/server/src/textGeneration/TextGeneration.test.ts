// fork: server-weight: upstream deleted this file; it keeps the unauthenticated-provider test.
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as TextGeneration from "./TextGeneration.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as Layer from "effect/Layer";

const makeStubTextGeneration = (
  overrides: Partial<TextGeneration.TextGeneration["Service"]>,
): TextGeneration.TextGeneration["Service"] =>
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () =>
      Effect.die("generateCommitMessage stub not configured for this test"),
    generatePrContent: () => Effect.die("generatePrContent stub not configured for this test"),
    generateBranchName: () => Effect.die("generateBranchName stub not configured for this test"),
    generateThreadTitle: () => Effect.die("generateThreadTitle stub not configured for this test"),
    generateReviewGuide: () => Effect.die("generateReviewGuide stub not configured for this test"),
    ...overrides,
  });

const makeStubInstance = (
  instanceId: ProviderInstanceId,
  textGeneration: TextGeneration.TextGeneration["Service"],
): ProviderInstance =>
  ({
    instanceId,
    driverKind: instanceId as unknown as ProviderInstance["driverKind"],
    continuationIdentity: {
      driverKind: instanceId as unknown as ProviderInstance["driverKind"],
      continuationKey: `${instanceId}:test`,
    },
    displayName: undefined,
    enabled: true,
    // fork: server-weight
    snapshot: {
      getSnapshot: Effect.succeed({ auth: { status: "unknown" } }),
    } as ProviderInstance["snapshot"],
    orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
    textGeneration,
  }) satisfies ProviderInstance;

const makeStubRegistry = (
  instances: ReadonlyArray<ProviderInstance>,
): ProviderInstanceRegistry.ProviderInstanceRegistry["Service"] => {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
  return {
    getInstance: (id) => Effect.succeed(byId.get(id)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};

describe("TextGeneration.make", () => {
  // fork: server-weight
  it.effect("does not invoke an unauthenticated provider", () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("grok");
      const instance = makeStubInstance(instanceId, makeStubTextGeneration({}));
      const generation = yield* TextGeneration.make.pipe(
        Effect.provideService(
          ProviderInstanceRegistry.ProviderInstanceRegistry,
          makeStubRegistry([
            {
              ...instance,
              snapshot: {
                ...instance.snapshot,
                getSnapshot: Effect.succeed({ auth: { status: "unauthenticated" } } as never),
              },
            },
          ]),
        ),
        Effect.provide(
          Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
            resolveLink: () => Effect.die("Unauthenticated generation must not resolve links"),
          }),
        ),
      );
      const result = yield* generation
        .generateThreadTitle({
          cwd: "/repo",
          message: "Title",
          modelSelection: createModelSelection(instanceId, "grok"),
        })
        .pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.detail).toContain("Sign in");
    }),
  );
});
