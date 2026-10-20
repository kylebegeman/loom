import * as HostProcess from "@t3tools/shared/HostProcess";
// @effect-diagnostics nodeBuiltinImport:off -- Node hashing and host profile locations are adapter boundaries.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  ModelPreviewError,
  type ImportSlicerProfile,
  type SlicerApp,
  SlicerProfileEntry,
  type SlicerProfileRef,
} from "@t3tools/contracts/fork";

export type ProfileKind = "machine" | "process" | "filament";
export type ProfileRoot = {
  readonly source: "system" | "user";
  readonly vendor: string | null;
  readonly directory: string;
  readonly version: string | null;
};
const Json = Schema.Record(Schema.String, Schema.Unknown);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Json));
const ProfileIndex = Schema.Struct({
  version: Schema.optionalKey(Schema.String),
  machine_list: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, sub_path: Schema.String })),
  ),
  process_list: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, sub_path: Schema.String })),
  ),
  filament_list: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, sub_path: Schema.String })),
  ),
  machine_model_list: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, sub_path: Schema.String })),
  ),
});
const decodeIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ProfileIndex));
const failure = (message: string) =>
  new ModelPreviewError({ reason: "invalid-parameter", message });
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const profileError = (cause: unknown) =>
  isModelError(cause) ? cause : failure("The slicer profile could not be read or saved.");
const isModelError = Schema.is(ModelPreviewError);
export const canonicalProfile = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalProfile).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${encodeJson(key)}:${canonicalProfile(child)}`)
      .join(",")}}`;
  return encodeJson(value) ?? "null";
};
export const profileHash = (json: unknown): string =>
  NodeCrypto.createHash("sha256").update(canonicalProfile(json)).digest("hex");
export const compareProfileVersion = (a: string | null, b: string | null): number => {
  const left = (a ?? "0").split(/\D+/).map(Number),
    right = (b ?? "0").split(/\D+/).map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff;
  }
  return 0;
};
export const selectProfileRoots = (roots: readonly ProfileRoot[]): ProfileRoot[] => {
  const selected = new Map<string, ProfileRoot>();
  for (const root of roots.filter((root) => root.source === "system")) {
    const existing = selected.get(root.vendor ?? root.directory);
    if (!existing || compareProfileVersion(root.version, existing.version) > 0)
      selected.set(root.vendor ?? root.directory, root);
  }
  return [...roots.filter((root) => root.source === "user"), ...selected.values()];
};
/** Reads installed indexes and user preset folders without changing the slicer's configuration. */
export const slicerProfileRoots = Effect.fn("Slicer.profileRoots")(function* (
  app: "bambu-studio" | "orca-slicer",
  home: string,
  executable: string,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const platform = yield* HostProcess.Platform,
    environment = yield* HostProcess.Environment;
  const appName = app === "bambu-studio" ? "BambuStudio" : "OrcaSlicer";
  const data =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", appName)
      : platform === "win32"
        ? path.join(environment.APPDATA ?? path.join(home, "AppData", "Roaming"), appName)
        : path.join(home, ".config", appName);
  const bundle = executable.includes(".app/")
    ? executable.slice(0, executable.indexOf(".app/") + 4)
    : null;
  const resource = bundle
    ? path.join(bundle, "Contents", "Resources", "profiles")
    : path.join(path.dirname(path.dirname(executable)), "share", appName, "profiles");
  const roots: ProfileRoot[] = [];
  for (const base of [resource, path.join(data, "system")]) {
    const names = yield* fs.readDirectory(base).pipe(Effect.orElseSucceed(() => []));
    for (const name of names.filter((name) => name.endsWith(".json"))) {
      const index = yield* fs
        .readFileString(path.join(base, name))
        .pipe(Effect.flatMap(decodeIndex), Effect.option);
      if (index._tag === "None") continue;
      roots.push({
        source: "system",
        vendor: name.slice(0, -5),
        directory: path.join(base, name.slice(0, -5)),
        version: index.value.version ?? null,
      });
    }
  }
  const users = yield* fs
    .readDirectory(path.join(data, "user"))
    .pipe(Effect.orElseSucceed(() => []));
  for (const user of users)
    roots.push({
      source: "user",
      vendor: null,
      directory: path.join(data, "user", user),
      version: null,
    });
  return selectProfileRoots(roots);
});
const readProfile = Effect.fn("Slicer.readProfile")(function* (filename: string) {
  const fs = yield* FileSystem.FileSystem;
  const stat = yield* fs
    .stat(filename)
    .pipe(Effect.mapError(() => failure("The slicer profile was deleted or moved.")));
  if (stat.size > 2 * 1024 * 1024) return yield* failure("This slicer profile is too large.");
  return yield* fs.readFileString(filename).pipe(
    Effect.flatMap(decodeJson),
    Effect.mapError(() => failure("This slicer profile is not valid JSON.")),
  );
});
const profileLocations = Effect.fn("Slicer.profileLocations")(function* (
  root: ProfileRoot,
  kind: ProfileKind | "machine_model",
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const locations = new Map<string, string>();
  if (root.vendor) {
    const index = yield* fs
      .readFileString(path.join(path.dirname(root.directory), `${root.vendor}.json`))
      .pipe(Effect.flatMap(decodeIndex), Effect.option);
    if (index._tag === "Some")
      for (const entry of index.value[`${kind}_list`] ?? []) {
        const segments = entry.sub_path.split(/[\\/]/);
        if (path.isAbsolute(entry.sub_path) || segments.includes("..")) continue;
        locations.set(entry.name, path.join(root.directory, entry.sub_path));
      }
  }
  const folder = path.join(root.directory, kind);
  const names = yield* fs.readDirectory(folder).pipe(Effect.orElseSucceed(() => []));
  for (const file of names.filter((file) => file.endsWith(".json"))) {
    if (!locations.has(file.slice(0, -5)))
      locations.set(file.slice(0, -5), path.join(folder, file));
  }
  return locations;
});
/** Leaf arrays replace parent arrays; system parents stay in their vendor's inheritance tree. */
export const flattenProfile = Effect.fn("Slicer.flattenProfile")(function* (
  roots: readonly ProfileRoot[],
  kind: ProfileKind,
  name: string,
  imported?: Readonly<Record<string, unknown>>,
  indexed?: readonly { root: ProfileRoot; files: ReadonlyMap<string, string> }[],
  cachedJson?: Map<string, Record<string, unknown>>,
) {
  const fs = yield* FileSystem.FileSystem;
  const ordered = selectProfileRoots(roots);
  const locations =
    indexed ??
    (yield* Effect.forEach(ordered, (root) =>
      profileLocations(root, kind).pipe(Effect.map((files) => ({ root, files }))),
    ));
  const chain = new Set<string>();
  let userPrice = false;
  let cliIdentity: string | null = null;
  const load = Effect.fnUntraced(function* (
    current: string,
    vendor: string | null,
    depth: number,
    leaf?: Readonly<Record<string, unknown>>,
  ): Effect.fn.Return<Record<string, unknown>, ModelPreviewError, FileSystem.FileSystem> {
    if (depth >= 16 || chain.has(current))
      return yield* failure(`The slicer profile inheritance loops at ${current}.`);
    chain.add(current);
    const found = leaf
      ? null
      : locations.find(
          (entry) => (vendor === null || entry.root.vendor === vendor) && entry.files.has(current),
        );
    if (!leaf && !found)
      return yield* failure(`The parent slicer profile ${current} was not found.`);
    const filename = found?.files.get(current);
    if (filename && !(yield* fs.exists(filename).pipe(Effect.mapError(profileError))))
      return yield* failure(`The parent slicer profile ${current} was not found.`);
    const json = leaf
      ? { ...leaf }
      : (cachedJson?.get(filename!) ?? (yield* readProfile(filename!)));
    if (filename) cachedJson?.set(filename, json);
    if (
      !cliIdentity &&
      found?.root.source === "system" &&
      ["true", true].includes(json.instantiation as string | boolean)
    )
      cliIdentity = current;
    if (
      depth === 0 &&
      (leaf || found?.root.source === "user") &&
      Object.hasOwn(json, "filament_cost")
    )
      userPrice = true;
    const parent =
      typeof json.inherits === "string" && json.inherits
        ? yield* load(json.inherits, found?.root.vendor ?? vendor, depth + 1)
        : {};
    chain.delete(current);
    return { ...parent, ...json };
  });
  const json = yield* load(name, null, 0, imported);
  delete json.inherits;
  json.name = name;
  json.type = json.type ?? kind;
  // Bambu CLI compares process compatibility against this identity even for fully flattened presets.
  json.inherits = cliIdentity ?? name;
  json.from = "User";
  json.instantiation = "true";
  return { json, hash: profileHash(json), userPrice };
});
const firstNumber = (value: unknown): number | null => {
  const first = Array.isArray(value) ? value[0] : value;
  const result =
    typeof first === "number" || typeof first === "string"
      ? Number(String(first).split(";")[0])
      : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
};
export const profileEntry = (
  name: string,
  source: SlicerProfileEntry["source"],
  json: Readonly<Record<string, unknown>>,
): SlicerProfileEntry => ({
  name,
  source,
  nozzleMm: firstNumber(json.nozzle_diameter),
  printerModel: typeof json.printer_model === "string" ? json.printer_model : null,
});
export const profileCompatible = (
  json: Readonly<Record<string, unknown>>,
  machine: string,
): boolean =>
  !Array.isArray(json.compatible_printers) ||
  !json.compatible_printers.length ||
  json.compatible_printers.includes(machine);
/** Prusa's exported full config stores slot values as semicolon separated lists. */
export const parsePrusaConfig = (text: string): Record<string, unknown> => {
  const json: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([a-z][a-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1]!,
      value = match[2]!;
    json[key] = key.startsWith("filament_") || key === "nozzle_diameter" ? value.split(";") : value;
  }
  if (Object.values(json).some((value) => Array.isArray(value) && value.length > 16))
    throw failure("PrusaSlicer configs support up to 16 filament slots.");
  if (!json.nozzle_diameter || !json.filament_diameter || !json.layer_height)
    throw failure(
      "Export a complete PrusaSlicer config, including printer, print and filament settings.",
    );
  return json;
};
export const makeProfiles = Effect.fn("Slicer.makeProfiles")(function* (
  stateDir: string,
  home: string,
  executable: (app: SlicerApp) => Effect.Effect<string | null, ModelPreviewError>,
) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const directory = path.join(stateDir, "slicer");
  yield* fs.makeDirectory(directory, { recursive: true });
  const ImportedSchema = Schema.Array(
    Schema.Struct({
      entry: Schema.Struct({
        name: Schema.String,
        source: Schema.Literal("imported"),
        nozzleMm: Schema.NullOr(Schema.Number),
        printerModel: Schema.NullOr(Schema.String),
      }),
      kind: Schema.Literals(["machine", "process", "filament", "config"]),
      filename: Schema.String,
    }),
  );
  const decodeImported = Schema.decodeUnknownEffect(Schema.fromJsonString(ImportedSchema));
  type Imported = (typeof ImportedSchema.Type)[number];
  const encodeImported = Schema.encodeEffect(Schema.fromJsonString(ImportedSchema));
  const imports = new Map<SlicerApp, readonly Imported[]>();
  const imported = Effect.fn("Slicer.importedProfiles")(function* (app: SlicerApp) {
    if (imports.has(app)) return imports.get(app)!;
    const decoded = yield* fs.readFileString(path.join(directory, `imports-${app}.json`)).pipe(
      Effect.flatMap(decodeImported),
      Effect.orElseSucceed(() => []),
    );
    const entries = decoded.filter(
      (item) =>
        path.dirname(item.filename) === path.join(directory, "imported", app, item.kind) &&
        /^[a-f0-9]{64}\.(?:json|ini)$/.test(path.basename(item.filename)),
    );
    imports.set(app, entries);
    return entries;
  });
  const roots = Effect.fn("Slicer.roots")(function* (app: SlicerApp) {
    const file = yield* executable(app);
    return app === "prusa-slicer" || !file ? [] : yield* slicerProfileRoots(app, home, file);
  });
  const resolve = Effect.fn("Slicer.resolveProfile")(function* (
    app: SlicerApp,
    kind: ProfileKind | "config",
    ref: SlicerProfileRef,
  ) {
    const rootList = yield* roots(app);
    if (ref.source === "imported") {
      const stored = (yield* imported(app)).find(
        (item) => item.kind === kind && item.entry.name === ref.name,
      );
      if (!stored) return yield* failure(`The imported profile ${ref.name} was not found.`);
      if (kind === "config") {
        const inputConfig = yield* fs.readFileString(stored.filename);
        return {
          json: yield* Effect.try({
            try: () => parsePrusaConfig(inputConfig),
            catch: (cause) =>
              isModelError(cause) ? cause : failure("This PrusaSlicer config is invalid."),
          }),
          userPrice: true,
          hash: path.basename(stored.filename).split(".")[0]!,
          filename: stored.filename,
          modelId: null as string | null,
        };
      }
      const flat = yield* flattenProfile(
        rootList,
        kind,
        ref.name,
        yield* readProfile(stored.filename),
      );
      const filename = path.join(directory, "profiles", `${flat.hash}.json`);
      yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
      yield* fs.writeFileString(filename, canonicalProfile(flat.json));
      return { ...flat, filename, modelId: yield* modelId(rootList, flat.json) };
    }
    if (kind === "config") return yield* failure("PrusaSlicer needs an imported config file.");
    const flat = yield* flattenProfile(rootList, kind, ref.name),
      filename = path.join(directory, "profiles", `${flat.hash}.json`);
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
    if (!(yield* fs.exists(filename)))
      yield* fs.writeFileString(filename, canonicalProfile(flat.json));
    return { ...flat, filename, modelId: yield* modelId(rootList, flat.json) };
  });
  const modelId = Effect.fn("Slicer.modelId")(function* (
    rootList: readonly ProfileRoot[],
    json: Readonly<Record<string, unknown>>,
  ) {
    if (typeof json.model_id === "string") return json.model_id;
    if (typeof json.printer_model !== "string") return null;
    for (const root of rootList) {
      const files = yield* profileLocations(root, "machine_model");
      const filename = files.get(json.printer_model);
      if (filename) {
        const model = yield* readProfile(filename);
        return typeof model.model_id === "string" ? model.model_id : null;
      }
    }
    return null;
  });
  const CachedIndex = Schema.Struct({
    version: Schema.NullOr(Schema.String),
    entries: Schema.Array(
      Schema.Struct({
        kind: Schema.Literals(["machine", "process", "filament"]),
        entry: SlicerProfileEntry,
        json: Json,
      }),
    ),
  });
  const decodeCachedIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(CachedIndex)),
    encodeCachedIndex = Schema.encodeEffect(Schema.fromJsonString(CachedIndex));
  const indexes = new Map<SlicerApp, { at: number; key: string; value: typeof CachedIndex.Type }>();
  const list = Effect.fn("Slicer.listProfiles")(function* (app: SlicerApp, machine?: string) {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    let index = indexes.get(app)?.value;
    if (!index || now - indexes.get(app)!.at >= 60000) {
      const rootList = yield* roots(app),
        locations = [] as {
          root: ProfileRoot;
          kind: ProfileKind;
          name: string;
          filename: string;
        }[],
        stamps: unknown[] = [];
      for (const root of rootList)
        for (const kind of ["machine", "process", "filament"] as const) {
          for (const [name, filename] of yield* profileLocations(root, kind)) {
            locations.push({ root, kind, name, filename });
            const stat = yield* fs.stat(filename).pipe(Effect.option);
            if (stat._tag === "Some")
              stamps.push([
                filename,
                String(stat.value.size),
                Option.getOrNull(stat.value.mtime)?.getTime() ?? null,
              ]);
          }
        }
      const key = profileHash([rootList, stamps]),
        cachedFile = path.join(directory, `index-${app}-${key}.json`);
      const disk = yield* fs
        .readFileString(cachedFile)
        .pipe(Effect.flatMap(decodeCachedIndex), Effect.option);
      if (disk._tag === "Some") index = disk.value;
      else {
        const entries = [] as (typeof CachedIndex.Type)["entries"][number][],
          seen = new Set<string>(),
          jsonCache = new Map<string, Record<string, unknown>>();
        const lookups = new Map<ProfileKind, { root: ProfileRoot; files: Map<string, string> }[]>();
        for (const kind of ["machine", "process", "filament"] as const)
          lookups.set(
            kind,
            rootList.map((root) => ({
              root,
              files: new Map(
                locations
                  .filter((item) => item.kind === kind && item.root === root)
                  .map((item) => [item.name, item.filename]),
              ),
            })),
          );
        for (const { root, kind, name, filename } of locations) {
          if (seen.has(`${kind}:${name}`)) continue;
          const leaf = yield* readProfile(filename).pipe(Effect.option);
          if (leaf._tag === "Some") jsonCache.set(filename, leaf.value);
          if (
            leaf._tag === "None" ||
            !["true", true].includes(leaf.value.instantiation as string | boolean)
          )
            continue;
          const flat = yield* flattenProfile(
            rootList,
            kind,
            name,
            undefined,
            lookups.get(kind),
            jsonCache,
          ).pipe(Effect.option);
          if (flat._tag === "None") continue;
          seen.add(`${kind}:${name}`);
          entries.push({
            kind,
            entry: profileEntry(name, root.source, flat.value.json),
            json: flat.value.json,
          });
          if (entries.length >= 3000) break;
        }
        index = { version: rootList.find((root) => root.version)?.version ?? null, entries };
        yield* fs.writeFileString(cachedFile, yield* encodeCachedIndex(index));
        for (const name of yield* fs.readDirectory(directory))
          if (name.startsWith(`index-${app}-`) && name !== path.basename(cachedFile))
            yield* fs.remove(path.join(directory, name), { force: true });
      }
      indexes.set(app, { at: now, key, value: index });
    }
    const result = {
      app,
      version: index.version,
      machines: [] as SlicerProfileEntry[],
      processes: [] as SlicerProfileEntry[],
      filaments: [] as SlicerProfileEntry[],
    };
    for (const kind of ["machine", "process", "filament"] as const) {
      const entries = new Map<string, SlicerProfileEntry>();
      for (const item of index.entries)
        if (
          item.kind === kind &&
          (kind === "machine" || (machine && profileCompatible(item.json, machine)))
        )
          entries.set(item.entry.name, item.entry);
      for (const item of yield* imported(app))
        if (item.kind === kind || (kind === "machine" && item.kind === "config"))
          entries.set(item.entry.name, item.entry);
      result[kind === "machine" ? "machines" : kind === "process" ? "processes" : "filaments"] = [
        ...entries.values(),
      ].slice(0, 1000);
    }
    return result;
  });
  const importProfile = Effect.fn("Slicer.importProfile")(function* (input: ImportSlicerProfile) {
    if (new TextEncoder().encode(input.text).length > 2 * 1024 * 1024)
      return yield* failure("This slicer profile is too large.");
    if ((input.app === "prusa-slicer") !== (input.kind === "config"))
      return yield* failure(
        "PrusaSlicer needs an INI config; Bambu Studio and OrcaSlicer need JSON presets.",
      );
    const json =
      input.kind === "config"
        ? yield* Effect.try({
            try: () => parsePrusaConfig(input.text),
            catch: (cause) =>
              isModelError(cause) ? cause : failure("This PrusaSlicer config is invalid."),
          })
        : yield* decodeJson(input.text).pipe(
            Effect.mapError(() => failure("This slicer profile is not valid JSON.")),
          );
    const name = (typeof json.name === "string" ? json.name : input.fileName).slice(0, 200);
    if (!name.trim()) return yield* failure("The slicer profile needs a name.");
    const hash = NodeCrypto.createHash("sha256").update(input.text).digest("hex");
    const filename = path.join(
      directory,
      "imported",
      input.app,
      input.kind,
      `${hash}.${input.kind === "config" ? "ini" : "json"}`,
    );
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true });
    if (input.kind !== "config")
      yield* flattenProfile(yield* roots(input.app), input.kind, name, json);
    yield* fs.writeFileString(filename, input.text);
    const entry = { ...profileEntry(name, "imported", json), source: "imported" as const };
    const rows = [
      ...(yield* imported(input.app)).filter(
        (row) => row.kind !== input.kind || row.entry.name !== name,
      ),
      { kind: input.kind, entry, filename },
    ];
    yield* fs.writeFileString(
      path.join(directory, `imports-${input.app}.json`),
      yield* encodeImported(rows),
    );
    imports.set(input.app, rows);
    return entry;
  });
  const clearCache = Effect.fn("Slicer.clearProfileCache")(function* () {
    indexes.clear();
    yield* fs.remove(path.join(directory, "profiles"), { recursive: true, force: true });
    for (const name of yield* fs.readDirectory(directory))
      if (name.startsWith("index-")) yield* fs.remove(path.join(directory, name), { force: true });
  });
  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(profileError),
    );
  return {
    roots: (app: SlicerApp) => provide(roots(app)),
    resolve: (app: SlicerApp, kind: ProfileKind | "config", ref: SlicerProfileRef) =>
      provide(resolve(app, kind, ref)),
    list: (app: SlicerApp, machine?: string) => provide(list(app, machine)),
    importProfile: (input: ImportSlicerProfile) => provide(importProfile(input)),
    clearCache: () => provide(clearCache()),
  };
});
