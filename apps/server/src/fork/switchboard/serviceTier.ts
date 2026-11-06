import type { ModelSelection, ServerProviderModel } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import { resolveSwitchboardController, switchboardCodexThreadOptions } from "./switchboard.ts";

const SWITCHBOARD_CODEX_MODELS = new Set(["gpt-6-astra", "gpt-6.1-sol"]);
const SWITCHBOARD_CODEX_TIERS = [
  { id: "priority", name: "Fast", description: "Priority processing through Switchboard" },
  {
    id: "ultrafast",
    name: "Ultrafast",
    description: "Switchboard routes to an eligible account or falls back to Fast",
  },
];

export function withSwitchboardServiceTiers(
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<ServerProviderModel> {
  return models.map((model) => {
    if (!SWITCHBOARD_CODEX_MODELS.has(model.slug)) return model;
    const descriptors = model.capabilities?.optionDescriptors ?? [];
    const previous = descriptors.find(
      (option) => option.id === "serviceTier" && option.type === "select",
    );
    return {
      ...model,
      capabilities: {
        ...model.capabilities,
        optionDescriptors: [
          ...descriptors.filter(
            (option) => option.id !== "fastMode" && option.id !== "serviceTier",
          ),
          {
            id: "serviceTier",
            label: "Service Tier",
            type: "select" as const,
            currentValue:
              previous?.type === "select" ? (previous.currentValue ?? "default") : "default",
            options: [
              { id: "default", label: "Standard", isDefault: true },
              { id: "priority", label: "Fast" },
              {
                id: "ultrafast",
                label: "Ultrafast",
                description: "Uses an eligible account, falling back to Fast when unavailable",
              },
            ],
          },
        ],
      },
    };
  });
}

export function switchboardTierSelection(
  selection: ModelSelection,
  effective: string,
): ModelSelection | null {
  if (
    getModelSelectionStringOptionValue(selection, "serviceTier") !== "ultrafast" ||
    effective !== "priority"
  )
    return null;
  return {
    ...selection,
    options: [
      ...(selection.options ?? []).filter(({ id }) => id !== "serviceTier" && id !== "fastMode"),
      { id: "serviceTier", value: "priority" },
    ],
  };
}

const Decision = Schema.Struct({
  decision: Schema.NullOr(
    Schema.Struct({
      model: Schema.String,
      requested: Schema.Literal("ultrafast"),
      effective: Schema.Literals(["ultrafast", "priority"]),
      observed: Schema.optional(
        Schema.NullOr(Schema.Literals(["default", "priority", "ultrafast", "flex", "scale"])),
      ),
      at: Schema.Number,
    }),
  ),
});

export const makeSwitchboardTierReader = Effect.fn("Switchboard.makeTierReader")(function* () {
  const http = yield* HttpClient.HttpClient;
  const environment = yield* HostProcess.Environment;
  return Effect.fn("Switchboard.readServiceTier")(
    function* (session: string, since: number, selection: ModelSelection) {
      if (
        switchboardCodexThreadOptions().modelProvider === undefined ||
        getModelSelectionStringOptionValue(selection, "serviceTier") !== "ultrafast"
      )
        return null;
      const controller = yield* Effect.try(() => resolveSwitchboardController(environment));
      if (!controller) return null;
      const response = yield* http.get(
        `${controller}/api/v1/service-tier?session=${encodeURIComponent(session)}&since=${since}`,
      );
      if (response.status !== 200) return null;
      const { decision } = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Decision)),
      );
      if (!decision || decision.model !== selection.model || decision.at < since) return null;
      if (decision.observed && decision.observed !== decision.effective) {
        yield* Effect.logWarning(
          "Switchboard upstream service tier differs from its routing decision",
          {
            model: decision.model,
            requested: decision.requested,
            forwarded: decision.effective,
            observed: decision.observed,
          },
        );
      }
      return switchboardTierSelection(selection, decision.observed ?? decision.effective);
    },
    Effect.timeout("2 seconds"),
    Effect.orElseSucceed(() => null),
  );
});

const CodexCatalog = Schema.fromJsonString(
  Schema.Struct({
    models: Schema.Array(Schema.Record(Schema.String, Schema.Json)),
  }),
);

const decodeCodexCatalog = Schema.decodeUnknownEffect(CodexCatalog);
const encodeCodexCatalog = Schema.encodeEffect(CodexCatalog);

export const makeSwitchboardCodexCatalog = Effect.fn("Switchboard.makeCodexCatalog")(function* (
  home: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = path.join(home, "models_cache.json");
  if (!(yield* fs.exists(source))) return undefined;
  const catalog = yield* fs.readFileString(source).pipe(Effect.flatMap(decodeCodexCatalog));
  const models = catalog.models.map((model) => {
    if (typeof model.slug !== "string" || !SWITCHBOARD_CODEX_MODELS.has(model.slug)) return model;
    const tiers = Array.isArray(model.service_tiers) ? model.service_tiers : [];
    const additions = SWITCHBOARD_CODEX_TIERS.filter(
      (supported) =>
        !tiers.some(
          (tier) =>
            tier !== null &&
            typeof tier === "object" &&
            !Array.isArray(tier) &&
            tier.id === supported.id,
        ),
    );
    return additions.length === 0 ? model : { ...model, service_tiers: [...tiers, ...additions] };
  });
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "loom-switchboard-codex-" });
  const file = path.join(directory, "models.json");
  yield* fs.writeFileString(file, yield* encodeCodexCatalog({ models }));
  return file;
});
