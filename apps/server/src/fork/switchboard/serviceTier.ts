import type * as CodexClient from "effect-codex-app-server/client";
import type * as CodexSchema from "effect-codex-app-server/schema";
import type { ModelSelection, ServerProviderModel } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import {
  readSwitchboardCredential,
  resolveSwitchboardControllerRoute,
  switchboardCatalogSource,
  switchboardControllerHeaders,
  switchboardCodexThreadOptions,
  type SwitchboardKeyCommand,
} from "./switchboard.ts";

/** Gateway path serving the account-holding computer's Codex catalog. */
export const SWITCHBOARD_CODEX_CATALOG_PATH = "/codex/models";
const SWITCHBOARD_CODEX_MODELS = new Set(["gpt-6-astra", "gpt-6.1-sol"]);
const SWITCHBOARD_CODEX_TIERS = [
  { id: "priority", name: "Fast", description: "Priority processing through Switchboard" },
  {
    id: "ultrafast",
    name: "Ultrafast",
    description: "Switchboard routes to an eligible account or falls back to Fast",
  },
];
class ServiceTierOperationError extends Schema.TaggedError<ServiceTierOperationError>()(
  "ServiceTierOperationError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Service Tier operation failed.";
  }
}

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
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return Effect.fn("Switchboard.readServiceTier")(
    function* (session: string, since: number, selection: ModelSelection) {
      if (
        switchboardCodexThreadOptions().modelProvider === undefined ||
        getModelSelectionStringOptionValue(selection, "serviceTier") !== "ultrafast"
      )
        return null;
      const controller = yield* Effect.try({
        try: () => resolveSwitchboardControllerRoute(environment, platform),
        catch: (cause) => new ServiceTierOperationError({ cause }),
      });
      if (!controller) return null;
      const headers = yield* switchboardControllerHeaders(controller, environment).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      if (Option.isNone(headers)) return null;
      const response = yield* http.get(
        `${controller.url}/api/v1/service-tier?session=${encodeURIComponent(session)}&since=${since}`,
        { headers: headers.value },
      );
      if (response.status !== 200) return null;
      const { decision } = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Decision)),
      );
      if (!decision || decision.model !== selection.model || decision.at < since) return null;
      if (decision.observed && decision.observed !== decision.effective) {
        yield* Effect.logDebug(
          "Switchboard response tier metadata differs from its routing decision",
          {
            model: decision.model,
            requested: decision.requested,
            forwarded: decision.effective,
            observed: decision.observed,
          },
        );
      }
      return switchboardTierSelection(selection, decision.effective);
    },
    Effect.timeout("2 seconds"),
    Effect.orElseSucceed(() => null),
  );
});

const CodexModels = Schema.Array(Schema.Record(Schema.String, Schema.Json));
type CodexModels = typeof CodexModels.Type;
const CodexCatalog = Schema.fromJsonString(Schema.Struct({ models: CodexModels }));
const CachedCodexCatalog = Schema.fromJsonString(
  Schema.Struct({ fetched_at: Schema.optional(Schema.String), models: CodexModels }),
);

const decodeCodexCatalog = Schema.decodeUnknownEffect(CodexCatalog);
const decodeCachedCodexCatalog = Schema.decodeUnknownEffect(CachedCodexCatalog);
const decodeSharedCodexCatalog = Schema.decodeUnknownEffect(Schema.Struct({ models: CodexModels }));
const encodeCodexCatalog = Schema.encodeEffect(CodexCatalog);

const routesSwitchboardModels = (models: CodexModels) => {
  const slugs = new Set(models.map((model) => model.slug));
  return [...SWITCHBOARD_CODEX_MODELS].every((slug) => slugs.has(slug));
};

/** The newest Codex catalog among `homes` that routes every Switchboard model, without cache metadata. */
export const readSharedCodexCatalog = Effect.fn("Switchboard.readSharedCodexCatalog")(function* (
  homes: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let newest: { readonly at: number; readonly models: CodexModels } | undefined;
  for (const home of new Set(homes)) {
    const catalog = yield* fs
      .readFileString(path.join(home, "models_cache.json"))
      .pipe(Effect.flatMap(decodeCachedCodexCatalog), Effect.option);
    if (Option.isNone(catalog) || !routesSwitchboardModels(catalog.value.models)) continue;
    const at = Date.parse(catalog.value.fetched_at ?? "");
    const fetchedAt = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
    if (newest === undefined || fetchedAt > newest.at)
      newest = { at: fetchedAt, models: catalog.value.models };
  }
  return newest === undefined ? undefined : { models: newest.models };
});

/** Reads the account-holding computer's catalog through its Switchboard gateway. */
export const fetchSharedCodexCatalog = Effect.fn("Switchboard.fetchSharedCodexCatalog")(
  function* (
    source: { readonly url: string; readonly keyCommand: SwitchboardKeyCommand },
    environment: NodeJS.ProcessEnv,
  ) {
    const http = yield* HttpClient.HttpClient;
    const key = yield* readSwitchboardCredential(source.keyCommand, environment);
    if (Option.isNone(key)) return undefined;
    const response = yield* http.get(`${source.url}${SWITCHBOARD_CODEX_CATALOG_PATH}`, {
      headers: { authorization: `Bearer ${Redacted.value(key.value)}` },
    });
    if (response.status !== 200) return undefined;
    const { models } = yield* response.json.pipe(Effect.flatMap(decodeSharedCodexCatalog));
    return routesSwitchboardModels(models) ? models : undefined;
  },
  Effect.timeout("5 seconds"),
  Effect.orElseSucceed(() => undefined),
);

// Codex removes service tiers its runtime catalog does not advertise.
export const makeSwitchboardCodexCatalog = Effect.fn("Switchboard.makeCodexCatalog")(function* (
  home: string,
  shared?: Effect.Effect<CodexModels | undefined>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = path.join(home, "models_cache.json");
  const local = (yield* fs.exists(source))
    ? (yield* fs.readFileString(source).pipe(Effect.flatMap(decodeCodexCatalog))).models
    : undefined;
  // Other clients rewrite this shared cache with catalogs tailored to them, and a computer
  // without a ChatGPT login never refreshes it. Pinning one without a routed model gives it
  // fallback metadata (a 272k window) for the process lifetime, so use the Switchboard
  // computer's catalog, or else let Codex load its own.
  const routed =
    local !== undefined && routesSwitchboardModels(local)
      ? local
      : shared === undefined
        ? undefined
        : yield* shared;
  if (routed === undefined) return undefined;
  const models = routed.map((model) => {
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

const encodeCodexConfigString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));

export const makeSwitchboardCodexArgs = Effect.fn("Switchboard.makeCodexArgs")(function* (
  args: ReadonlyArray<string> | undefined,
  homePath: string,
  environment: NodeJS.ProcessEnv,
) {
  if (!args?.length) return args;
  const path = yield* Path.Path;
  const home =
    homePath || environment.CODEX_HOME || path.join(yield* HostProcess.HomeDirectory, ".codex");
  const source = switchboardCatalogSource();
  const shared =
    source === undefined
      ? undefined
      : fetchSharedCodexCatalog(source, yield* HostProcess.Environment).pipe(
          Effect.provideService(HttpClient.HttpClient, yield* HttpClient.HttpClient),
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            yield* ChildProcessSpawner.ChildProcessSpawner,
          ),
        );
  const file = yield* makeSwitchboardCodexCatalog(home, shared);
  return file
    ? [...args, "-c", `model_catalog_json=${yield* encodeCodexConfigString(file)}`]
    : args;
});

export const codexAdvertisesUltrafast = Effect.fn("Switchboard.codexAdvertisesUltrafast")(
  function* (client: CodexClient.CodexAppServerClient["Service"], model: string) {
    let cursor: string | null = null;
    do {
      const page: CodexSchema.V2ModelListResponse = yield* client.request("model/list", {
        includeHidden: true,
        ...(cursor ? { cursor } : {}),
      });
      if (
        page.data.some(
          (entry) =>
            entry.model === model && entry.serviceTiers?.some((tier) => tier.id === "ultrafast"),
        )
      )
        return true;
      cursor = page.nextCursor ?? null;
    } while (cursor);
    return false;
  },
);
