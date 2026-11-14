import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { setSwitchboardEnvironment, setSwitchboardEnabled } from "./switchboard.ts";
import {
  fetchSharedCodexCatalog,
  makeSwitchboardTierReader,
  makeSwitchboardCodexCatalog,
  readSharedCodexCatalog,
  switchboardTierSelection,
  withSwitchboardServiceTiers,
} from "./serviceTier.ts";

it("offers pooled Ultrafast independently of the local login and preserves reasoning", () => {
  const models = withSwitchboardServiceTiers([
    {
      slug: "gpt-6.1-sol",
      name: "Sol",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          { id: "fastMode", label: "Fast", type: "boolean", currentValue: false },
        ],
      },
    },
    { slug: "gpt-6-luna", name: "Luna", isCustom: false, capabilities: null },
  ]);
  assert.deepStrictEqual(models[0]?.capabilities?.optionDescriptors?.[0], {
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    currentValue: "default",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      {
        id: "ultrafast",
        label: "Ultrafast",
        description: "Uses an eligible account, falling back to Fast when unavailable",
      },
    ],
  });
  assert.equal(models[1]?.capabilities, null);
});
it("changes only an Ultrafast selection to the effective Fast tier", () => {
  const selection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-6.1-sol",
    options: [
      { id: "serviceTier", value: "ultrafast" },
      { id: "reasoningEffort", value: "high" },
    ],
  };
  assert.deepStrictEqual(switchboardTierSelection(selection, "priority"), {
    ...selection,
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ],
  });
  assert.equal(switchboardTierSelection(selection, "ultrafast"), null);
  assert.equal(switchboardTierSelection({ ...selection, options: [] }, "priority"), null);
});

it.effect(
  "reads the selected environment's cached tier and ignores missing, stale or mismatched decisions",
  () =>
    Effect.gen(function* () {
      setSwitchboardEnvironment(
        { LOOM_SWITCHBOARD_CONTROLLER_URL: "https://hub.example.test" },
        "darwin",
      );
      setSwitchboardEnabled(true);
      try {
        const requests: string[] = [];
        let decision: unknown = {
          model: "gpt-6.1-sol",
          requested: "ultrafast",
          effective: "priority",
          at: 1000,
        };
        const http = HttpClient.make((request) => {
          requests.push(request.url);
          return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ decision })));
        });
        const reader = yield* makeSwitchboardTierReader().pipe(
          Effect.provideService(HttpClient.HttpClient, http),
          Effect.provideService(HostProcess.Environment, {
            LOOM_SWITCHBOARD_CONTROLLER_URL: "https://hub.example.test",
          }),
        );
        const selection = {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-6.1-sol",
          options: [{ id: "serviceTier", value: "ultrafast" }],
        };
        assert.equal(
          (yield* reader("native-thread", 999, selection))?.options?.[0]?.value,
          "priority",
        );
        assert.deepEqual(requests, [
          "https://hub.example.test/api/v1/service-tier?session=native-thread&since=999",
        ]);
        decision = {
          model: selection.model,
          requested: "ultrafast",
          effective: "priority",
          observed: "default",
          at: 1000,
        };
        assert.equal(
          (yield* reader("native-thread", 999, selection))?.options?.[0]?.value,
          "priority",
        );
        decision = {
          model: "gpt-6-astra",
          requested: "ultrafast",
          effective: "priority",
          at: 1000,
        };
        assert.equal(yield* reader("native-thread", 999, selection), null);
        decision = {
          model: selection.model,
          requested: "ultrafast",
          effective: "priority",
          at: 998,
        };
        assert.equal(yield* reader("native-thread", 999, selection), null);
        decision = null;
        assert.equal(yield* reader("native-thread", 999, selection), null);
        setSwitchboardEnabled(false);
        const before = requests.length;
        assert.equal(yield* reader("native-thread", 999, selection), null);
        assert.equal(requests.length, before);
      } finally {
        setSwitchboardEnabled(false);
        setSwitchboardEnvironment({}, "darwin");
      }
    }),
);

it.effect("prepares a pooled Codex catalog without changing native account metadata", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      assert.equal(yield* makeSwitchboardCodexCatalog(home), undefined);
      const models = [
        {
          slug: "gpt-6.1-sol",
          base_instructions: "Keep native instructions",
          service_tiers: [{ id: "priority", name: "Fast", description: "Fast processing" }],
          context_window: 500000,
        },
        { slug: "gpt-6-astra", base_instructions: "Astra", service_tiers: [] },
        { slug: "gpt-6-luna", service_tiers: [] },
      ];
      // Another client's catalog omits Sol; pinning it would give Sol fallback metadata.
      yield* fs.writeFileString(
        path.join(home, "models_cache.json"),
        JSON.stringify({ models: models.slice(1) }),
      );
      assert.equal(yield* makeSwitchboardCodexCatalog(home), undefined);
      // Without a ChatGPT login this cache never refreshes; the Switchboard computer's catalog stands in.
      const routed = yield* makeSwitchboardCodexCatalog(home, Effect.succeed(models));
      assert.deepEqual(
        JSON.parse(yield* fs.readFileString(routed!)).models.map(
          (model: { slug: string; service_tiers: Array<{ id: string }> }) => [
            model.slug,
            model.service_tiers.map((tier) => tier.id),
          ],
        ),
        [
          ["gpt-6.1-sol", ["priority", "ultrafast"]],
          ["gpt-6-astra", ["priority", "ultrafast"]],
          ["gpt-6-luna", []],
        ],
      );
      assert.equal(yield* makeSwitchboardCodexCatalog(home, Effect.undefined), undefined);
      const source = JSON.stringify({ models, identity: { account: "native-account" } });
      yield* fs.writeFileString(path.join(home, "models_cache.json"), source);
      const file = yield* makeSwitchboardCodexCatalog(
        home,
        Effect.die("a local catalog with the routed models needs no fetch"),
      );
      assert.isDefined(file);
      const catalog = JSON.parse(yield* fs.readFileString(file!));
      assert.deepEqual(catalog.models[0], {
        ...models[0],
        service_tiers: [
          models[0]!.service_tiers[0],
          {
            id: "ultrafast",
            name: "Ultrafast",
            description: "Switchboard routes to an eligible account or falls back to Fast",
          },
        ],
      });
      assert.deepEqual(
        catalog.models[1].service_tiers.map((tier: { id: string }) => tier.id),
        ["priority", "ultrafast"],
      );
      assert.deepEqual(catalog.models[2], models[2]);
      assert.equal(catalog.identity, undefined);
      assert.equal(yield* fs.readFileString(path.join(home, "models_cache.json")), source);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("shares the newest catalog that routes both Switchboard models", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homes = [
        yield* fs.makeTempDirectoryScoped(),
        yield* fs.makeTempDirectoryScoped(),
        yield* fs.makeTempDirectoryScoped(),
        yield* fs.makeTempDirectoryScoped(),
      ];
      const sol = { slug: "gpt-6.1-sol", base_instructions: "Sol" };
      const astra = { slug: "gpt-6-astra" };
      const write = (home: string, catalog: unknown) =>
        fs.writeFileString(path.join(home, "models_cache.json"), JSON.stringify(catalog));
      yield* write(homes[0]!, { fetched_at: "2026-11-13T10:00:00.000000Z", models: [sol, astra] });
      yield* write(homes[1]!, {
        fetched_at: "2026-11-13T12:00:00.123456Z",
        etag: "private",
        models: [{ ...sol, base_instructions: "Newest" }, astra],
      });
      // Newer, but tailored to a client that does not route Sol.
      yield* write(homes[2]!, { fetched_at: "2026-11-13T13:00:00Z", models: [astra] });
      assert.deepEqual(yield* readSharedCodexCatalog([...homes, homes[1]!]), {
        models: [{ ...sol, base_instructions: "Newest" }, astra],
      });
      assert.equal(yield* readSharedCodexCatalog([homes[2]!, homes[3]!]), undefined);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("fetches the shared catalog with the client credential and rejects partial ones", () =>
  Effect.gen(function* () {
    const key = "c".repeat(64);
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    let body: unknown = { models: [{ slug: "gpt-6.1-sol" }, { slug: "gpt-6-astra" }] };
    let status = 200;
    const http = HttpClient.make((request) => {
      requests.push({ url: request.url, authorization: request.headers.authorization });
      return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status })));
    });
    const spawner = ChildProcessSpawner.make(() =>
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          getInputFd: () => Sink.drain,
          stderr: Stream.empty,
          all: Stream.empty,
          stdout: Stream.succeed(new TextEncoder().encode(key)),
          getOutputFd: () => Stream.empty,
        }),
      ),
    );
    const fetch = fetchSharedCodexCatalog(
      {
        url: "https://dorothy.example.test/api/loom/switchboard",
        keyCommand: { command: "/usr/bin/security", args: [] },
      },
      {},
    ).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );
    assert.deepEqual(yield* fetch, [{ slug: "gpt-6.1-sol" }, { slug: "gpt-6-astra" }]);
    assert.deepEqual(requests, [
      {
        url: "https://dorothy.example.test/api/loom/switchboard/codex/models",
        authorization: `Bearer ${key}`,
      },
    ]);
    body = { models: [{ slug: "gpt-6-astra" }] };
    assert.equal(yield* fetch, undefined);
    status = 404;
    assert.equal(yield* fetch, undefined);
  }),
);
