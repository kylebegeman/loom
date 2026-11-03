// @effect-diagnostics nodeBuiltinImport:off -- Content digests pin imports and dotenv revisions; Node parses dotenv without evaluating it.
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { stableStringify } from "@t3tools/shared/relaySigning";
import {
  type DevApiWorkflowWatch,
  type DevApiWorkflowProgress,
  LibraryApiBundle,
  DevApiLibraryBinding,
  DevApiWorkflow,
  DevApiWorkflowRun,
  DevApiWorkflowSummary,
  type DevApiWorkflowCommand,
  type DevApiWorkflowState,
  type DevHttpExchange,
  type DevApiAuthor,
  type DevApiAuthorResult,
  DevApiError,
  DevApiVariable,
  DevApiRunResult,
  type DevApiDetails,
  type DevApiWorkspace,
  type DevApiWorkspaceTarget,
  type DevApiImport,
  type DevApiRead,
  type DevApiEnvironmentTarget,
  type DevApiSaveEnvironment,
  type DevApiEnvironment,
  type DevApiRun,
  type DevApiSaveRequest,
  type DevApiExport,
  VaultError,
  type DevTarget,
  type DevEnvironmentError,
  type DevHttpError,
} from "@t3tools/contracts/fork";
import * as Stream from "effect/Stream";
import * as PubSub from "effect/PubSub";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Redacted from "effect/Redacted";
import * as Option from "effect/Option";
import * as DevApiCredentials from "./DevApiCredentials.ts";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../../config.ts";
import { ProcessRunner } from "../../processRunner.ts";
import { DevEnvironmentService } from "./DevEnvironmentService.ts";
import { DevRequestsService } from "./DevRequestsService.ts";
import { checkoutKey } from "./servers.ts";
import { redactHeaders, redactSensitive, redactExchangeSecrets } from "./requests.ts";
import { updateDotenv } from "./dotenv.ts";
import { portableApiJson, portableApiWorkflows } from "./apiPortable.ts";
import { workflowChecks, workflowValue } from "./apiWorkflow.ts";
import { blankRequest, blankCollection, importCurl, importOpenApi } from "./apiImports.ts";
import { API_SCRIPT_RUNNER } from "./apiScriptRunner.ts";
import {
  HoppscotchInputError,
  applyRequestEdits,
  importHoppscotch,
  prepareHoppscotchRequest,
  type NativeRequest,
} from "./hoppscotch.ts";
const WORKFLOW_HISTORY_LIMIT = 40;
const WORKFLOW_RECEIPT_LIMIT = 2000;
const MAX_ACTIVE_WORKFLOWS = 4;
const Entry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  folders: Schema.Array(Schema.String),
  method: Schema.String,
  file: Schema.String,
});
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  files: Schema.Array(Schema.Struct({ name: Schema.String, hash: Schema.String })),
  folders: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
  workflows: Schema.optionalKey(Schema.Array(DevApiWorkflow)),
  library: Schema.optionalKey(DevApiLibraryBinding),
  editBase: Schema.optionalKey(Schema.String),
  requests: Schema.Array(Entry),
  environments: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      variables: Schema.Array(DevApiVariable),
    }),
  ),
});
const Receipt = Schema.Struct({
  id: Schema.String,
  fingerprint: Schema.String,
  result: Schema.NullOr(DevApiRunResult),
  error: Schema.NullOr(DevApiError.fields.reason),
});
const State = Schema.Struct({
  version: Schema.Literal(1),
  requestEdits: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  editBase: Schema.optionalKey(Schema.String),
  dotenvBindings: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(DevApiVariable))),
  environmentBases: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(DevApiVariable))),
  environments: Schema.Record(Schema.String, Schema.Array(DevApiVariable)),
  overlays: Schema.Record(Schema.String, Schema.Array(DevApiVariable)),
  receipts: Schema.Array(Receipt),
});
const ScriptResult = Schema.Struct({
  ok: Schema.Boolean,
  variables: Schema.Record(Schema.String, Schema.String),
  checks: Schema.Array(Schema.Struct({ name: Schema.String, passed: Schema.Boolean })),
  changed: Schema.Array(Schema.String),
});
const Json = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeEffect(Json);
const decodeJson = Schema.decodeEffect(Json);
const stringifyJson = Schema.encodeSync(Json);
const parseRoots = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
);
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(Manifest));
const encodeState = Schema.encodeEffect(Schema.fromJsonString(State));
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(Manifest));
const decodeState = Schema.decodeEffect(Schema.fromJsonString(State));
const RunSummary = Schema.Struct({
  ...DevApiWorkflowSummary.fields,
  fingerprint: Schema.optionalKey(Schema.String),
});
const decodeRunIndex = Schema.decodeEffect(Schema.fromJsonString(Schema.Array(RunSummary)));
const encodeRunIndex = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(RunSummary)));
const decodeWorkflowRun = Schema.decodeEffect(Schema.fromJsonString(DevApiWorkflowRun));
const encodeWorkflowRun = Schema.encodeEffect(Schema.fromJsonString(DevApiWorkflowRun));
const decodeScript = Schema.decodeEffect(Schema.fromJsonString(ScriptResult));
type State = typeof State.Type;
type Manifest = typeof Manifest.Type;
type Failure = DevApiError | DevEnvironmentError | DevHttpError | VaultError;
const decodeUnknownRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
function environmentVariables(manifest: Manifest, state: State, id: string) {
  const definitions = manifest.environments.find((e) => e.id === id)?.variables ?? [];
  const local = state.environments[id];
  const base = state.environmentBases?.[id];
  if (!local || !base) return local ?? definitions;
  const previous = new Map(base.map((v) => [v.key, v]));
  const overrides = new Map(local.map((v) => [v.key, v]));
  return [
    ...definitions.flatMap((definition) => {
      const value = overrides.get(definition.key);
      if (!value) return previous.has(definition.key) ? [] : [definition];
      return [
        value.vault ||
        value.secret ||
        JSON.stringify(value) !== JSON.stringify(previous.get(value.key))
          ? { ...value, secret: value.secret || definition.secret }
          : definition,
      ];
    }),
    ...local.filter(
      (v) =>
        !definitions.some((d) => d.key === v.key) &&
        JSON.stringify(v) !== JSON.stringify(previous.get(v.key)),
    ),
  ];
}
function withEnvironment(
  state: State,
  manifest: Manifest,
  id: string,
  variables: readonly DevApiVariable[],
): State {
  return {
    ...state,
    environments: { ...state.environments, [id]: variables },
    environmentBases: {
      ...state.environmentBases,
      [id]: manifest.environments.find((e) => e.id === id)?.variables ?? [],
    },
  };
}
function portableEnvironmentExport(
  source: unknown,
  fileName: string,
  manifest: Manifest,
  state: State,
) {
  const roots = (Array.isArray(source) ? source : [source]).map((entry, index) => {
    const object = entry as Record<string, unknown>;
    const id = `${fileName}/e${index}`;
    const variables = environmentVariables(manifest, state, id);
    const original = Array.isArray(object.variables)
      ? (object.variables as Record<string, unknown>[])
      : [];
    return {
      ...object,
      variables: variables.map(({ vault, ...v }) => ({
        ...original.find((row) => row.key === v.key),
        key: v.key,
        secret: v.secret || Boolean(vault),
        initialValue: v.secret || vault ? "" : v.value,
        currentValue: "",
      })),
    };
  });
  return JSON.stringify(Array.isArray(source) ? roots : roots[0]);
}
const digest = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
const fingerprint = (value: unknown) => digest(stableStringify(value));
export class DevApiService extends Context.Service<
  DevApiService,
  {
    readonly forkWorkspace: (
      input: DevApiWorkspaceTarget & { expectedRevision: string; requestId: string },
    ) => Effect.Effect<DevApiDetails, Failure>;
    readonly bundle: (
      input: DevApiWorkspaceTarget & { expectedRevision?: string },
    ) => Effect.Effect<LibraryApiBundle, Failure>;
    readonly markShared: (
      input: DevApiWorkspaceTarget & { expectedRevision: string; binding: DevApiLibraryBinding },
    ) => Effect.Effect<DevApiDetails, Failure>;
    readonly installBundle: (
      input: DevTarget & {
        expectedRevision?: string;
        bundle: LibraryApiBundle;
        requestId: string;
        binding: DevApiLibraryBinding;
      },
    ) => Effect.Effect<DevApiDetails, Failure>;
    readonly watchWorkflow: (
      input: DevApiWorkflowWatch,
    ) => Stream.Stream<DevApiWorkflowProgress, Failure>;
    readonly workflow: (
      input: DevApiWorkflowCommand,
      caller?: DevApiCredentials.ApiCredentialCaller,
    ) => Effect.Effect<DevApiWorkflowState, Failure>;
    readonly author: (input: DevApiAuthor) => Effect.Effect<DevApiAuthorResult, Failure>;
    readonly list: (input: DevTarget) => Effect.Effect<readonly DevApiWorkspace[], Failure>;
    readonly import: (input: DevApiImport) => Effect.Effect<DevApiDetails, Failure>;
    readonly importDirectory: (
      input: DevTarget & { readonly name: string; readonly directory: string },
    ) => Effect.Effect<DevApiDetails, Failure>;
    readonly read: (input: DevApiRead) => Effect.Effect<DevApiDetails, Failure>;
    readonly environment: (
      input: DevApiEnvironmentTarget,
    ) => Effect.Effect<DevApiEnvironment, Failure>;
    readonly saveEnvironment: (
      input: DevApiSaveEnvironment,
    ) => Effect.Effect<DevApiEnvironment, Failure>;
    readonly run: (
      input: DevApiRun,
      caller?: DevApiCredentials.ApiCredentialCaller,
    ) => Effect.Effect<DevApiRunResult, Failure>;
    readonly saveRequest: (input: DevApiSaveRequest) => Effect.Effect<DevApiDetails, Failure>;
    readonly export: (input: DevApiWorkspaceTarget) => Effect.Effect<DevApiExport, Failure>;
    readonly remove: (input: DevApiWorkspaceTarget) => Effect.Effect<void, Failure>;
  }
>()("t3/fork/browser-dev-tools/DevApiService") {}
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const dev = yield* DevEnvironmentService;
  const requests = yield* DevRequestsService;
  const runner = yield* ProcessRunner;
  const credentials = yield* Effect.serviceOption(DevApiCredentials.DevApiCredentials);
  const gate = yield* Semaphore.make(1);
  const workflowGate = yield* Semaphore.make(1);
  const runGate = yield* Semaphore.make(1);
  const scope = yield* Effect.scope;
  const updates = yield* PubSub.unbounded<{
    workspaceId: string;
    progress: DevApiWorkflowProgress;
  }>();
  const activeRuns = new Map<string, { cancelled: boolean }>();
  const directory = path.join(config.stateDir, "fork", "browser-dev-tools", "api-workspaces");
  const location = (id: string) => (/^[a-f\d]{24}$/.test(id) ? path.join(directory, id) : null);
  const storageError = (cause: unknown) =>
    new DevApiError({ reason: "storage-unavailable", cause });
  const fileFor = (id: string, name: string) => {
    const root = location(id);
    if (!root) throw new DevApiError({ reason: "not-found" });
    return path.join(root, name);
  };
  const readManifest = Effect.fn("DevApi.readManifest")(function* (id: string) {
    if (!location(id)) return yield* new DevApiError({ reason: "not-found" });
    return yield* fs
      .readFileString(fileFor(id, "manifest.json"))
      .pipe(Effect.flatMap(decodeManifest), Effect.mapError(storageError));
  });
  const stateFor = Effect.fn("DevApi.state")(function* (id: string) {
    const text = yield* fs.readFileString(fileFor(id, "state.json")).pipe(
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed('{"version":1,"environments":{},"overlays":{},"receipts":[]}'),
      ),
    );
    return yield* decodeState(text);
  }, Effect.mapError(storageError));
  const write = Effect.fn("DevApi.write")(
    function* (file: string, contents: string) {
      yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
      yield* writeFileStringAtomically({ filePath: file, contents });
      yield* fs.chmod(file, 0o600);
    },
    Effect.mapError(storageError),
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
  );
  const save = Effect.fn("DevApi.save")(function* (id: string, state: State) {
    const text = yield* encodeState(state).pipe(Effect.mapError(storageError));
    yield* write(fileFor(id, "state.json"), text);
  });
  const summary = (m: Manifest): DevApiWorkspace => ({
    id: m.id,
    name: m.name,
    requestCount: m.requests.length,
    environmentCount: m.environments.length,
  });
  const activeEdits = (m: Manifest, state: State) =>
    m.editBase === state.editBase ? (state.requestEdits ?? {}) : {};
  const revisionFor = (m: Manifest, state: State) => {
    const { library: _library, ...manifest } = m;
    return fingerprint({ manifest, requestEdits: activeEdits(m, state) });
  };
  const native = Effect.fn("DevApi.native")(function* (
    m: Manifest,
    key: string,
    override?: string,
  ) {
    const entry = m.requests.find((r) => r.id === key);
    const file = m.files.find((f) => f.name === entry?.file);
    if (!entry || !file) return yield* new DevApiError({ reason: "not-found" });
    const text = yield* fs
      .readFileString(fileFor(m.id, `${file.hash}.json`))
      .pipe(Effect.mapError(storageError));
    if (digest(text) !== file.hash) return yield* new DevApiError({ reason: "revision-conflict" });
    const state = yield* stateFor(m.id);
    const edits = {
      ...activeEdits(m, state),
      ...(override === undefined ? {} : { [key]: override }),
    };
    const parsed = yield* Effect.try({
      try: () =>
        importHoppscotch(
          Object.keys(edits).length ? applyRequestEdits(text, file.name, edits) : text,
          file.name,
        ),
      catch: (e) =>
        e instanceof HoppscotchInputError ? new DevApiError({ reason: e.reason }) : storageError(e),
    });
    const selected =
      parsed.kind === "collections" ? parsed.requests.find((r) => r.id === key) : null;
    if (!selected) return yield* new DevApiError({ reason: "not-found" });
    return selected;
  });
  const dotenvPath = Effect.fn("DevApi.dotenvPath")(function* (root: string, relative: string) {
    if (path.isAbsolute(relative) || !/^\.env(?:\.[\w.-]+)?$/.test(path.basename(relative)))
      return yield* new DevApiError({ reason: "invalid-path" });
    const realRoot = yield* fs.realPath(root).pipe(Effect.mapError(storageError));
    const resolved = yield* fs
      .realPath(path.resolve(realRoot, relative))
      .pipe(Effect.mapError(storageError));
    const distance = path.relative(realRoot, resolved);
    if (distance === ".." || distance.startsWith(`..${path.sep}`) || path.isAbsolute(distance))
      return yield* new DevApiError({ reason: "invalid-path" });
    const stat = yield* fs.stat(resolved).pipe(Effect.mapError(storageError));
    if (stat.type !== "File" || stat.size > 262144)
      return yield* new DevApiError({ reason: "file-too-large" });
    return resolved;
  });
  const getEnvironment = Effect.fn("DevApi.getEnvironment")(function* (
    input: DevApiEnvironmentTarget,
    m: Manifest,
    state: State,
    root: string,
  ) {
    if (input.source.kind === "none")
      return { revision: fingerprint([]), variables: [], overlayKey: null, file: null, text: null };
    if (input.source.kind === "json") {
      const sourceId = input.source.id;
      const source = m.environments.find((e) => e.id === sourceId);
      if (!source) return yield* new DevApiError({ reason: "not-found" });
      const variables = environmentVariables(m, state, source.id);
      return {
        revision: fingerprint(variables),
        variables,
        overlayKey: null,
        file: null,
        text: null,
      };
    }
    const file = yield* dotenvPath(root, input.source.path);
    const text = yield* fs.readFileString(file).pipe(Effect.mapError(storageError));
    const overlayKey = `${checkoutKey(root)}:${input.source.path}:${digest(text)}`;
    const base = yield* Effect.try({
      try: () =>
        Object.entries(NodeUtil.parseEnv(text)).flatMap(([key, value]) =>
          value === undefined ? [] : [{ key, value, secret: true }],
        ),
      catch: () => new DevApiError({ reason: "invalid-format" }),
    });
    const variables: readonly DevApiVariable[] = state.overlays[overlayKey] ?? base;
    const bindingKey = `${checkoutKey(root)}:${input.source.path}`;
    const bindings = state.dotenvBindings?.[bindingKey] ?? [];
    const merged: DevApiVariable[] = variables.map(({ vault: _vault, ...v }) => {
      const binding = bindings.find((b) => b.key === v.key);
      return binding?.vault ? { ...v, value: "", secret: true, vault: binding.vault } : v;
    });
    for (const binding of bindings)
      if (!merged.some((v) => v.key === binding.key)) merged.push(binding);
    return {
      revision: fingerprint({ text, variables: merged }),
      variables: merged,
      overlayKey,
      file,
      text,
    };
  });
  const discoverDotenv = Effect.fn("DevApi.discoverDotenv")(function* (root: string) {
    const found: string[] = [];
    const pending = [{ relative: "", depth: 0 }];
    let inspected = 0;
    while (pending.length && inspected < 1000) {
      const item = pending.shift()!;
      const entries = yield* fs
        .readDirectory(path.join(root, item.relative))
        .pipe(Effect.orElseSucceed(() => []));
      for (const name of entries) {
        if (++inspected > 1000) break;
        const relative = path.join(item.relative, name);
        if (/^\.env(?:\.[\w.-]+)?$/.test(name)) found.push(relative);
        else if (
          item.depth < 2 &&
          !name.startsWith(".") &&
          !["node_modules", "dist", "build", "vendor"].includes(name)
        ) {
          const stat = yield* fs.stat(path.join(root, relative)).pipe(Effect.option);
          if (stat._tag === "Some" && stat.value.type === "Directory")
            pending.push({ relative, depth: item.depth + 1 });
        }
      }
    }
    return found.sort().slice(0, 100);
  });
  const details = Effect.fn("DevApi.details")(function* (
    input: DevApiRead,
    m: Manifest,
    root: string,
  ) {
    const state = yield* stateFor(m.id);
    const selected = input.requestKey ? yield* native(m, input.requestKey) : null;
    return {
      workspace: summary(m),
      ...(m.library ? { library: m.library } : {}),
      folders: m.folders ?? [],
      revision: revisionFor(m, yield* stateFor(m.id)),
      requests: m.requests.map(({ file: _file, ...r }) => {
        const edited = activeEdits(m, state)[r.id];
        if (!edited) return r;
        const value = decodeUnknownRequest(edited);
        return {
          ...r,
          name: typeof value.name === "string" ? value.name : r.name,
          method: typeof value.method === "string" ? value.method : r.method,
        };
      }),
      environments: m.environments.map(({ id, name }) => ({ id, name })),
      dotenvFiles: yield* discoverDotenv(root),
      selected: selected
        ? {
            id: selected.id,
            variables: selected.variables,
            sourceJson: yield* encodeJson(selected.source).pipe(Effect.mapError(storageError)),
            endpoint: String(selected.source.endpoint),
            bodyContentType:
              selected.source.body &&
              typeof selected.source.body === "object" &&
              "contentType" in selected.source.body &&
              typeof selected.source.body.contentType === "string"
                ? selected.source.body.contentType
                : null,
            preScripts: selected.preScripts,
            testScripts: selected.testScripts,
          }
        : null,
    };
  });
  const list = Effect.fn("DevApi.list")(function* (input: DevTarget) {
    yield* dev.snapshot(input);
    const entries = yield* fs.readDirectory(directory).pipe(
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed([]),
      ),
      Effect.mapError(storageError),
    );
    const result: DevApiWorkspace[] = [];
    for (const id of entries.filter((id) => location(id)))
      if (yield* fs.exists(fileFor(id, "manifest.json")).pipe(Effect.mapError(storageError)))
        result.push(summary(yield* readManifest(id)));
    return result.toSorted((a, b) => a.name.localeCompare(b.name));
  }, gate.withPermit);
  const read = Effect.fn("DevApi.read")(function* (input: DevApiRead) {
    const { root } = yield* dev.snapshot(input);
    return yield* details(input, yield* readManifest(input.workspaceId), root);
  }, gate.withPermit);
  const pruneSourceFiles = Effect.fn("DevApi.pruneSourceFiles")(function* (m: Manifest) {
    const retained = new Set(m.files.map((file) => `${file.hash}.json`));
    const names = yield* fs.readDirectory(location(m.id)!).pipe(Effect.mapError(storageError));
    for (const name of names)
      if (/^[a-f\d]{64}\.json$/.test(name) && !retained.has(name))
        yield* fs.remove(fileFor(m.id, name)).pipe(Effect.orElseSucceed(() => undefined));
  });
  const importWorkspace = Effect.fn("DevApi.import")(function* (
    input: DevApiImport,
    install?: {
      requestId: string;
      bundle: LibraryApiBundle;
      binding: DevApiLibraryBinding;
      expectedRevision?: string;
    },
  ) {
    const { root } = yield* dev.snapshot(input);
    const bytes = input.files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0);
    if (
      !input.files.length ||
      input.files.length > 30 ||
      bytes > 67108864 ||
      input.files.some((f) => Buffer.byteLength(f.content) > 16777216)
    )
      return yield* new DevApiError({ reason: "file-too-large" });
    if (
      new Set(input.files.map((f) => f.name)).size !== input.files.length ||
      input.files.some((f) => path.basename(f.name) !== f.name)
    )
      return yield* new DevApiError({ reason: "invalid-format" });
    const id =
      install?.bundle.id ??
      fingerprint({
        name: input.name,
        files: input.files
          .map((f) => ({ name: f.name, hash: digest(f.content) }))
          .toSorted((a, b) => a.name.localeCompare(b.name)),
      }).slice(0, 24);
    if (yield* fs.exists(fileFor(id, "manifest.json")).pipe(Effect.mapError(storageError))) {
      const existing = yield* readManifest(id);
      if (!install) return yield* details({ ...input, workspaceId: id }, existing, root);
      const state = yield* stateFor(id);
      if (revisionFor(existing, state) !== install.expectedRevision)
        return yield* new DevApiError({ reason: "revision-conflict" });
      yield* save(id, {
        ...state,
        environmentBases: Object.fromEntries(
          existing.environments.map((e) => [e.id, state.environmentBases?.[e.id] ?? e.variables]),
        ),
      });
    } else if (install?.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const files: Array<{ name: string; hash: string }> = [];
    const entries: Array<typeof Entry.Type> = [];
    const environments: Array<Manifest["environments"][number]> = [];
    for (const file of input.files.toSorted((a, b) => a.name.localeCompare(b.name))) {
      const parsed = yield* Effect.try({
        try: () => importHoppscotch(file.content, file.name),
        catch: (e) =>
          e instanceof HoppscotchInputError
            ? new DevApiError({ reason: e.reason })
            : storageError(e),
      });
      files.push({ name: file.name, hash: digest(file.content) });
      if (parsed.kind === "collections")
        for (const r of parsed.requests)
          entries.push({
            id: r.id,
            name: r.name,
            folders: r.folders,
            method: String(r.source.method),
            file: file.name,
          });
      else
        parsed.environments.forEach((e, index) =>
          environments.push({ id: `${file.name}/e${index}`, ...e }),
        );
    }
    let m: Manifest = {
      version: 1,
      id,
      name: input.name,
      files,
      requests: entries,
      environments,
    };
    if (install) {
      m = {
        ...m,
        workflows: install.bundle.workflows,
        folders: install.bundle.folders,
        editBase: fingerprint({ bundle: install.bundle, requestId: install.requestId }),
        library: install.binding,
      };
      m = {
        ...m,
        library: { ...install.binding, baseRevision: revisionFor(m, yield* stateFor(id)) },
      };
    }
    for (const file of input.files)
      yield* write(fileFor(id, `${digest(file.content)}.json`), file.content);
    yield* write(
      fileFor(id, "manifest.json"),
      yield* encodeManifest(m).pipe(Effect.mapError(storageError)),
    );
    yield* pruneSourceFiles(m);
    return yield* details({ ...input, workspaceId: id }, m, root);
  }, gate.withPermit);
  const authorExisting = Effect.fn("DevApi.authorExisting")(function* (input: DevApiAuthor) {
    const { root } = yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId!);
    const state = yield* stateFor(m.id);
    if (revisionFor(m, state) !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const fileName = input.action.startsWith("openapi") ? "openapi.json" : "pulse.json";
    const existingFile = m.files.find((f) => f.name === fileName);
    const original = existingFile
      ? yield* fs
          .readFileString(fileFor(m.id, `${existingFile.hash}.json`))
          .pipe(Effect.mapError(storageError))
      : stringifyJson([blankCollection(m.name)]);
    const generated = yield* Effect.try({
      try: () => {
        if (input.action.startsWith("openapi"))
          return importOpenApi(input.content ?? "").collection;
        const roots = parseRoots(original) as Record<string, unknown>[];
        let folder = roots[0]!;
        for (const name of input.folders) {
          const folders = folder.folders as Record<string, unknown>[];
          let child = folders.find((f) => f.name === name);
          if (!child) {
            child = blankCollection(name);
            folders.push(child);
          }
          folder = child;
        }
        if (input.action === "folder") {
          const folders = folder.folders as Record<string, unknown>[];
          if (!folders.some((f) => f.name === input.name))
            folders.push(blankCollection(input.name));
        } else {
          const requests = folder.requests as Record<string, unknown>[];
          const loomId = `manual:${input.requestId}`;
          if (!requests.some((r) => r.loomId === loomId))
            requests.push({
              ...(input.action === "curl"
                ? importCurl(input.content ?? "")
                : blankRequest(input.name)),
              name: input.name,
              loomId,
            });
        }
        return stringifyJson(roots);
      },
      catch: (e) =>
        new DevApiError({
          reason: e instanceof HoppscotchInputError ? e.reason : "invalid-format",
        }),
    });
    const parsed = yield* Effect.try({
      try: () => importHoppscotch(generated, fileName),
      catch: () => new DevApiError({ reason: "invalid-format" }),
    });
    if (parsed.kind !== "collections") return yield* new DevApiError({ reason: "invalid-format" });
    const previous = importHoppscotch(original, fileName);
    const oldRequests = previous.kind === "collections" ? previous.requests : [];
    const changes: DevApiAuthorResult["changes"][number][] = [];
    for (const r of parsed.requests) {
      const old = oldRequests.find((p) => p.id === r.id);
      if (!old) changes.push({ id: r.id, name: r.name, kind: "added" });
      else if (fingerprint(old.source) !== fingerprint(r.source))
        changes.push({
          id: r.id,
          name: r.name,
          kind: activeEdits(m, state)[r.id] ? "customized" : "changed",
        });
    }
    const retained = oldRequests.filter(
      (r) => !parsed.requests.some((p) => p.id === r.id) && activeEdits(m, state)[r.id],
    );
    for (const old of oldRequests.filter((r) => !parsed.requests.some((p) => p.id === r.id)))
      changes.push({
        id: old.id,
        name: old.name,
        kind: activeEdits(m, state)[old.id] ? "customized" : "removed",
      });
    if (input.action === "openapi-preview") return { details: null, changes };
    const roots = parseRoots(generated) as Record<string, unknown>[];
    (roots[0]!.requests as unknown[]).push(...retained.map((r) => r.source));
    const content = stringifyJson(roots);
    const final = importHoppscotch(content, fileName);
    if (final.kind !== "collections") return yield* new DevApiError({ reason: "invalid-format" });
    const hash = digest(content);
    const environmentFile =
      input.action === "openapi-apply"
        ? { name: "api.environment.json", content: importOpenApi(input.content ?? "").environment }
        : null;
    const importedEnvironment = environmentFile
      ? importHoppscotch(environmentFile.content, environmentFile.name)
      : null;
    const next: Manifest = {
      ...m,
      environments:
        importedEnvironment?.kind === "environments"
          ? [
              ...m.environments.filter((e) => !e.id.startsWith("api.environment.json/")),
              ...importedEnvironment.environments.map((e, index) => ({
                id: `api.environment.json/e${index}`,
                ...e,
              })),
            ]
          : m.environments,
      folders:
        input.action === "folder"
          ? [...(m.folders ?? []), [m.name, ...input.folders, input.name]]
          : (m.folders ?? []),
      files: [
        ...m.files.filter((f) => f.name !== fileName && f.name !== environmentFile?.name),
        { name: fileName, hash },
        ...(environmentFile
          ? [{ name: environmentFile.name, hash: digest(environmentFile.content) }]
          : []),
      ],
      requests: [
        ...m.requests.filter((r) => r.file !== fileName),
        ...final.requests.map((r) => ({
          id: r.id,
          name: r.name,
          folders: r.folders,
          method: String(r.source.method),
          file: fileName,
        })),
      ],
    };
    if (environmentFile) {
      yield* save(m.id, {
        ...state,
        environmentBases: Object.fromEntries(
          m.environments.map((e) => [e.id, state.environmentBases?.[e.id] ?? e.variables]),
        ),
      });
      yield* write(
        fileFor(m.id, `${digest(environmentFile.content)}.json`),
        environmentFile.content,
      );
    }
    yield* write(fileFor(m.id, `${hash}.json`), content);
    yield* write(
      fileFor(m.id, "manifest.json"),
      yield* encodeManifest(next).pipe(Effect.mapError(storageError)),
    );
    yield* pruneSourceFiles(next);
    const key = final.requests.find((r) => r.source.loomId === `manual:${input.requestId}`)?.id;
    return {
      details: yield* details(
        { ...input, workspaceId: m.id, ...(key ? { requestKey: key } : {}) },
        next,
        root,
      ),
      changes,
    };
  }, gate.withPermit);
  const author = Effect.fn("DevApi.author")(function* (input: DevApiAuthor) {
    if (input.workspaceId) return yield* authorExisting(input);
    const files = yield* Effect.try({
      try: () => {
        if (input.action.startsWith("openapi")) {
          const result = importOpenApi(input.content ?? "");
          return [
            { name: "openapi.json", content: result.collection },
            { name: "api.environment.json", content: result.environment },
          ];
        }
        const root = blankCollection(input.name);
        if (input.action === "curl")
          root.requests.push({
            ...importCurl(input.content ?? ""),
            loomId: `manual:${input.requestId}`,
          });
        return [{ name: "pulse.json", content: stringifyJson([root]) }];
      },
      catch: (e) =>
        new DevApiError({
          reason: e instanceof HoppscotchInputError ? e.reason : "invalid-format",
        }),
    });
    return { details: yield* importWorkspace({ ...input, files }), changes: [] };
  });
  const importDirectory = Effect.fn("DevApi.importDirectory")(function* (
    input: DevTarget & { readonly name: string; readonly directory: string },
  ) {
    yield* dev.snapshot(input);
    const names = (yield* fs.readDirectory(input.directory).pipe(Effect.mapError(storageError)))
      .filter((name) => name.endsWith(".json"))
      .sort();
    if (!names.length || names.length > 30)
      return yield* new DevApiError({ reason: "invalid-format" });
    const files: Array<{ name: string; content: string }> = [];
    let total = 0;
    for (const name of names) {
      const file = path.join(input.directory, name);
      const stat = yield* fs.stat(file).pipe(Effect.mapError(storageError));
      total += Number(stat.size);
      if (stat.type !== "File" || stat.size > 16777216 || total > 67108864)
        return yield* new DevApiError({ reason: "file-too-large" });
      files.push({
        name,
        content: yield* fs.readFileString(file).pipe(Effect.mapError(storageError)),
      });
    }
    return yield* importWorkspace({ ...input, files });
  });
  const environment = Effect.fn("DevApi.environment")(function* (input: DevApiEnvironmentTarget) {
    const { root } = yield* dev.snapshot(input);
    const env = yield* getEnvironment(
      input,
      yield* readManifest(input.workspaceId),
      yield* stateFor(input.workspaceId),
      root,
    );
    return { revision: env.revision, variables: env.variables };
  });
  const validateVariables = (variables: readonly DevApiVariable[]) =>
    variables.length <= 1000 &&
    new Set(variables.map((v) => v.key)).size === variables.length &&
    variables.every((v) => v.key.length > 0 && v.key.length <= 200 && v.value.length <= 262144);
  const saveEnvironment = Effect.fn("DevApi.saveEnvironment")(function* (
    input: DevApiSaveEnvironment,
  ) {
    const { root } = yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId);
    const state = yield* stateFor(input.workspaceId);
    const env = yield* getEnvironment(input, m, state, root);
    if (env.revision !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const proposed = input.patch
      ? [...new Map([...env.variables, ...input.variables].map((v) => [v.key, v])).values()]
      : input.variables;
    const variables = proposed.map((v) => (v.vault ? { ...v, value: "", secret: true } : v));
    if (!validateVariables(variables) || input.source.kind === "none")
      return yield* new DevApiError({ reason: "invalid-format" });
    if (input.source.kind === "json")
      yield* save(m.id, withEnvironment(state, m, input.source.id, variables));
    else if (env.file && env.text !== null) {
      const contents = yield* Effect.try({
        try: () =>
          updateDotenv(
            env.text!,
            variables.filter((v) => !v.vault),
          ),
        catch: () => new DevApiError({ reason: "invalid-format" }),
      });
      if (Buffer.byteLength(contents) > 262144)
        return yield* new DevApiError({ reason: "file-too-large" });
      if (
        digest(yield* fs.readFileString(env.file).pipe(Effect.mapError(storageError))) !==
        digest(env.text)
      )
        return yield* new DevApiError({ reason: "revision-conflict" });
      if (contents !== env.text) yield* write(env.file, contents);
      if (input.source.kind === "dotenv") {
        const bindingKey = `${checkoutKey(root)}:${input.source.path}`;
        const overlayKey = `${bindingKey}:${digest(contents)}`;
        yield* save(m.id, {
          ...state,
          dotenvBindings: {
            ...state.dotenvBindings,
            [bindingKey]: variables.filter((v) => v.vault),
          },
          overlays: { ...state.overlays, [overlayKey]: variables.filter((v) => !v.vault) },
        });
      }
    }
    return yield* environment(input);
  }, gate.withPermit);
  const scripts = Effect.fn("DevApi.scripts")(function* (
    root: string,
    source: readonly string[],
    variables: Readonly<Record<string, string>>,
    response: {
      status: number;
      body: unknown;
      headers: readonly { key: string; value: string }[];
    } | null,
  ) {
    if (!source.length) return { ok: true, variables, checks: [], changed: [] };
    const stdin = yield* encodeJson({
      scripts: source,
      variables,
      response: response ?? { status: 0, body: null, headers: [] },
    }).pipe(Effect.mapError(storageError));
    const result = yield* runner
      .run({
        command: process.execPath,
        args: [
          "--permission",
          "--max-old-space-size=64",
          "--input-type=module",
          "--eval",
          API_SCRIPT_RUNNER,
        ],
        cwd: root,
        env: { ELECTRON_RUN_AS_NODE: "1" },
        extendEnv: false,
        stdin,
        timeout: "3 seconds",
        maxOutputBytes: 1048576,
      })
      .pipe(Effect.mapError((cause) => new DevApiError({ reason: "script-failed", cause })));
    if (result.code !== 0) return yield* new DevApiError({ reason: "script-failed" });
    return yield* decodeScript(result.stdout).pipe(
      Effect.mapError((cause) => new DevApiError({ reason: "script-failed", cause })),
    );
  });
  const capture = (
    existing: readonly DevApiVariable[],
    values: Readonly<Record<string, string>>,
    changed: readonly string[],
  ) => {
    const next = new Map(existing.map((v) => [v.key, v]));
    for (const key of changed) {
      if (next.get(key)?.vault) continue;
      if (Object.hasOwn(values, key))
        next.set(key, { key, value: values[key]!, secret: next.get(key)?.secret ?? true });
      else next.delete(key);
    }
    return [...next.values()];
  };
  const executeRun = Effect.fn("DevApi.run")(function* (
    input: DevApiRun,
    caller?: DevApiCredentials.ApiCredentialCaller,
    execution?: {
      variables: Readonly<Record<string, string>>;
      capture: (exchange: DevHttpExchange) => void;
    },
  ) {
    const { root } = yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId);
    const state = yield* stateFor(m.id);
    const hash = fingerprint(input);
    const prior = state.receipts.find((r) => r.id === input.requestId);
    if (prior) {
      if (prior.fingerprint !== hash) return yield* new DevApiError({ reason: "request-conflict" });
      if (prior.result) return prior.result;
      return yield* new DevApiError({ reason: prior.error ?? "outcome-unknown" });
    }
    if (revisionFor(m, state) !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const env = yield* getEnvironment(input, m, state, root);
    if (env.revision !== input.environmentRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const selected: NativeRequest = yield* native(m, input.requestKey, input.requestOverride);
    const values = Object.fromEntries(
      [...env.variables, ...selected.variables].map((v) => [v.key, v.value]),
    );
    let pending: State = {
      ...state,
      receipts: [
        ...state.receipts
          .slice(-1999)
          .map((r, i, a) => (i < a.length - 49 ? { ...r, result: null } : r)),
        { id: input.requestId, fingerprint: hash, result: null, error: null },
      ],
    };
    yield* save(m.id, pending);
    const executed = yield* Effect.gen(function* () {
      const bound = env.variables.filter(
        (v) => v.vault && !selected.variables.some((own) => own.key === v.key),
      );
      if (bound.length && (Option.isNone(credentials) || !caller))
        return yield* new DevApiError({ reason: "vault-required" });
      const resolved =
        bound.length && Option.isSome(credentials) && caller
          ? yield* credentials.value.resolve(bound, caller)
          : {
              values: Redacted.make({} as Readonly<Record<string, string>>),
              authorize: (_url: string) => Effect.void,
            };
      const privateValues = Redacted.value(resolved.values);
      const sensitiveValues = [
        ...Object.values(privateValues),
        ...selected.variables
          .filter((v) => v.secret)
          .map((v) => v.value)
          .filter(Boolean),
        ...env.variables
          .filter((v) => v.secret)
          .map((v) => v.value)
          .filter(Boolean),
        ...Object.values(execution?.variables ?? {}).filter(Boolean),
      ];
      Object.assign(values, execution?.variables ?? {});
      Object.assign(
        values,
        privateValues,
        Object.fromEntries(selected.variables.map((v) => [v.key, v.value])),
        execution?.variables ?? {},
      );
      const safeChanged = (
        changed: readonly string[],
        variables: Readonly<Record<string, string>>,
      ) =>
        changed.filter(
          (key) =>
            redactSensitive(variables[key] ?? "", sensitiveValues) === (variables[key] ?? ""),
        );
      const before = yield* scripts(root, selected.preScripts, values, null);
      const beforeVars = capture(
        env.variables,
        before.variables,
        safeChanged(before.changed, before.variables),
      );
      if (!validateVariables(beforeVars))
        return yield* new DevApiError({ reason: "invalid-format" });
      if (input.source.kind !== "none" && !execution) {
        if (input.source.kind === "json")
          pending = withEnvironment(pending, m, input.source.id, beforeVars);
        else if (env.overlayKey)
          pending = { ...pending, overlays: { ...pending.overlays, [env.overlayKey]: beforeVars } };
      }
      yield* save(m.id, pending);
      const preparedEnvironment = yield* getEnvironment(input, m, pending, root);
      if (!before.ok || before.checks.some((c) => !c.passed))
        return yield* new DevApiError({ reason: "script-failed" });
      const request = yield* Effect.try({
        try: () =>
          prepareHoppscotchRequest(
            { ...selected, variables: [] },
            before.variables,
            input.bodyBase64,
            input.uploads,
          ),
        catch: (e) =>
          e instanceof HoppscotchInputError
            ? new DevApiError({ reason: e.reason })
            : new DevApiError({ reason: "invalid-format" }),
      });
      yield* resolved.authorize(request.url);
      const exchange = yield* requests.sendForWorkflow(
        {
          threadId: input.threadId,
          requestId: `api:${m.id}:${input.requestId}`,
          request,
        },
        sensitiveValues,
      );
      execution?.capture(exchange);
      const responseBody = yield* decodeJson(exchange.body).pipe(
        Effect.orElseSucceed(() => exchange.body),
      );
      const after =
        exchange.error || exchange.truncated || exchange.binary
          ? { ok: false, variables: before.variables, checks: [], changed: [] }
          : yield* scripts(root, selected.testScripts, before.variables, {
              status: exchange.status ?? 0,
              body: responseBody,
              headers: Object.entries(exchange.headers).map(([key, value]) => ({ key, value })),
            }).pipe(
              Effect.orElseSucceed(() => ({
                ok: false,
                variables: before.variables,
                checks: [],
                changed: [],
              })),
            );
      const latestEnv = yield* getEnvironment(input, m, yield* stateFor(m.id), root);
      const vars = capture(
        env.variables,
        after.variables,
        safeChanged([...before.changed, ...after.changed], after.variables),
      );
      const environmentUpdated =
        !execution &&
        input.source.kind !== "none" &&
        latestEnv.revision === preparedEnvironment.revision &&
        validateVariables(vars);
      let next = pending;
      if (environmentUpdated) {
        if (input.source.kind === "json") next = withEnvironment(next, m, input.source.id, vars);
        else if (env.overlayKey)
          next = { ...next, overlays: { ...next.overlays, [env.overlayKey]: vars } };
      }
      const result: DevApiRunResult = {
        exchange: redactExchangeSecrets(
          { ...exchange, headers: redactHeaders(exchange.headers) },
          sensitiveValues,
        ),
        checks: [
          ...before.checks.map((c) => ({ ...c, name: redactSensitive(c.name, sensitiveValues) })),
          ...after.checks.map((c) => ({ ...c, name: redactSensitive(c.name, sensitiveValues) })),
          ...(!after.ok ? [{ name: "Response script could not complete", passed: false }] : []),
        ],
        environmentUpdated,
      };
      next = {
        ...next,
        receipts: next.receipts.map((r) => (r.id === input.requestId ? { ...r, result } : r)),
      };
      yield* save(m.id, next);
      return result;
    }).pipe(Effect.result);
    if (Result.isSuccess(executed)) return executed.success;
    const failed = executed.failure;
    const error = failed._tag === "DevApiError" ? failed.reason : "outcome-unknown";
    yield* save(m.id, {
      ...pending,
      receipts: pending.receipts.map((r) => (r.id === input.requestId ? { ...r, error } : r)),
    });
    return yield* failed;
  }, gate.withPermit);
  const run = Effect.fn("DevApi.runRequest")(
    (input: DevApiRun, caller?: DevApiCredentials.ApiCredentialCaller) => executeRun(input, caller),
  );
  const runFile = (workspaceId: string, id: string) =>
    fileFor(workspaceId, `run-${digest(id)}.json`);
  const readRun = Effect.fn("DevApi.readRun")(function* (workspaceId: string, id: string) {
    return yield* fs
      .readFileString(runFile(workspaceId, id))
      .pipe(Effect.flatMap(decodeWorkflowRun), Effect.mapError(storageError));
  });
  const progressFor = (value: DevApiWorkflowRun): DevApiWorkflowProgress => ({
    id: value.id,
    state: value.state,
    completed: value.results.length,
    latest: value.results.at(-1)?.name ?? null,
  });
  const runIndex = Effect.fn("DevApi.runIndex")(function* (workspaceId: string) {
    return yield* fs.readFileString(fileFor(workspaceId, "workflow-runs.json")).pipe(
      Effect.catchIf(
        (e) => e.reason._tag === "NotFound",
        () => Effect.succeed("[]"),
      ),
      Effect.flatMap(decodeRunIndex),
      Effect.mapError(storageError),
    );
  });
  const saveRun = Effect.fn("DevApi.saveRun")(function* (
    workspaceId: string,
    value: DevApiWorkflowRun,
  ) {
    const bounded = {
      ...value,
      results: value.results.map((row) =>
        row.result
          ? {
              ...row,
              result: {
                ...row.result,
                exchange: {
                  ...row.result.exchange,
                  request: {
                    ...row.result.exchange.request,
                    body: row.result.exchange.request.body.slice(0, 4096),
                  },
                  body: row.result.exchange.body.slice(0, 4096),
                  truncated:
                    row.result.exchange.truncated || row.result.exchange.body.length > 4096,
                },
              },
            }
          : row,
      ),
    };
    yield* write(
      runFile(workspaceId, value.id),
      yield* encodeWorkflowRun(bounded).pipe(Effect.mapError(storageError)),
    );
    const prior = [...(yield* runIndex(workspaceId))];
    const names = yield* fs
      .readDirectory(location(workspaceId)!)
      .pipe(Effect.mapError(storageError));
    const knownFiles = new Set(prior.map((r) => path.basename(runFile(workspaceId, r.id))));
    for (const name of names) {
      if (
        !/^run-[a-f\d]{64}\.json$/.test(name) ||
        knownFiles.has(name) ||
        name === path.basename(runFile(workspaceId, value.id))
      )
        continue;
      const old = yield* fs
        .readFileString(fileFor(workspaceId, name))
        .pipe(Effect.flatMap(decodeWorkflowRun), Effect.option);
      if (Option.isSome(old))
        prior.push({
          id: old.value.id,
          fingerprint: old.value.fingerprint,
          workflowId: old.value.workflowId,
          name: old.value.name ?? old.value.workflowId,
          startedAt: old.value.startedAt ?? "",
          state: old.value.state,
          completed: old.value.results.length,
        });
    }
    const summaries = [
      {
        id: value.id,
        fingerprint: value.fingerprint,
        workflowId: value.workflowId,
        name: value.name ?? value.workflowId,
        startedAt: value.startedAt ?? "",
        state: value.state,
        completed: value.results.length,
      },
      ...prior.filter((r) => r.id !== value.id),
    ].slice(0, WORKFLOW_RECEIPT_LIMIT);
    yield* write(
      fileFor(workspaceId, "workflow-runs.json"),
      yield* encodeRunIndex(summaries).pipe(Effect.mapError(storageError)),
    );
    const retained = new Set(
      summaries
        .slice(0, WORKFLOW_HISTORY_LIMIT)
        .map((r) => path.basename(runFile(workspaceId, r.id))),
    );
    for (const name of names) {
      if (!/^run-[a-f\d]{64}\.json$/.test(name) || retained.has(name)) continue;
      const active = [...activeRuns.keys()].some(
        (key) =>
          key.startsWith(`${workspaceId}:`) &&
          path.basename(runFile(workspaceId, key.slice(workspaceId.length + 1))) === name,
      );
      if (!active)
        yield* fs.remove(fileFor(workspaceId, name)).pipe(Effect.orElseSucceed(() => undefined));
    }
    yield* PubSub.publish(updates, { workspaceId, progress: progressFor(value) });
  }, runGate.withPermit);
  const watchWorkflow = (input: DevApiWorkflowWatch) =>
    Stream.unwrap(
      Effect.gen(function* () {
        yield* dev.snapshot(input);
        const subscription = yield* PubSub.subscribe(updates);
        const initial = yield* readRun(input.workspaceId, input.runId);
        const key = `${input.workspaceId}:${input.runId}`;
        const progress = progressFor(
          (initial.state === "running" || initial.state === "stopping") && !activeRuns.has(key)
            ? { ...initial, state: "interrupted" }
            : initial,
        );
        return Stream.make(progress).pipe(
          Stream.concat(
            Stream.fromSubscription(subscription).pipe(
              Stream.filter(
                (event) =>
                  event.workspaceId === input.workspaceId && event.progress.id === input.runId,
              ),
              Stream.map((event) => event.progress),
            ),
          ),
          Stream.takeUntil((value) => !["running", "stopping"].includes(value.state)),
        );
      }),
    );
  const workflow = Effect.fn("DevApi.workflow")(function* (
    input: DevApiWorkflowCommand,
    caller?: DevApiCredentials.ApiCredentialCaller,
  ) {
    yield* dev.snapshot(input);
    let m = yield* readManifest(input.workspaceId);
    const state = yield* stateFor(m.id);
    const revision = revisionFor(m, state);
    const key = `${m.id}:${input.runId}`;
    if (input.action === "save" || input.action === "delete")
      yield* gate.withPermit(
        Effect.gen(function* () {
          m = yield* readManifest(input.workspaceId);
          const latestRevision = revisionFor(m, yield* stateFor(m.id));
          if (input.expectedRevision !== latestRevision)
            return yield* new DevApiError({ reason: "revision-conflict" });
          const definition = input.workflow;
          if (
            input.action === "save" &&
            (!definition ||
              (!m.workflows?.some((w) => w.id === definition.id) &&
                (m.workflows?.length ?? 0) >= 100) ||
              !definition.steps.length ||
              new Set(definition.steps.map((s) => s.id)).size !== definition.steps.length ||
              definition.steps.some((s) => !m.requests.some((r) => r.id === s.requestKey)) ||
              definition.steps.length * Math.max(1, definition.datasets.length) > 100)
          )
            return yield* new DevApiError({ reason: "invalid-format" });
          m = {
            ...m,
            workflows: [
              ...(m.workflows ?? []).filter((w) => w.id !== (definition?.id ?? input.workflowId)),
              ...(input.action === "save" && definition ? [definition] : []),
            ],
          };
          yield* write(
            fileFor(m.id, "manifest.json"),
            yield* encodeManifest(m).pipe(Effect.mapError(storageError)),
          );
        }),
      );
    let current: DevApiWorkflowRun | null = null;
    if (input.action === "start") {
      if (!input.runId || !input.source)
        return yield* new DevApiError({ reason: "invalid-format" });
      const hash = fingerprint(input);
      if (yield* fs.exists(runFile(m.id, input.runId)).pipe(Effect.mapError(storageError))) {
        current = yield* readRun(m.id, input.runId);
        if (current.fingerprint !== hash)
          return yield* new DevApiError({ reason: "request-conflict" });
      } else {
        const receipt = (yield* runIndex(m.id)).find((r) => r.id === input.runId);
        if (receipt)
          return yield* new DevApiError({
            reason:
              receipt.fingerprint && receipt.fingerprint !== hash
                ? "request-conflict"
                : "outcome-unknown",
          });
        if (input.expectedRevision !== revision)
          return yield* new DevApiError({ reason: "revision-conflict" });
        const definition = m.workflows?.find((w) => w.id === input.workflowId);
        if (!definition) return yield* new DevApiError({ reason: "not-found" });
        if (input.workflow && fingerprint(input.workflow) !== fingerprint(definition))
          return yield* new DevApiError({ reason: "revision-conflict" });
        if (activeRuns.size >= MAX_ACTIVE_WORKFLOWS)
          return yield* new DevApiError({ reason: "workflow-limit" });
        if (
          !definition.steps.length ||
          definition.steps.length * Math.max(1, definition.datasets.length) > 100
        )
          return yield* new DevApiError({ reason: "invalid-format" });
        current = {
          id: input.runId,
          workflowId: definition.id,
          name: definition.name,
          startedAt: DateTime.formatIso(yield* DateTime.now),
          fingerprint: hash,
          state: "running",
          results: [],
        };
        yield* saveRun(m.id, current);
        const token = { cancelled: false };
        activeRuns.set(key, token);
        const initial = current;
        const source = input.source;
        const execute = Effect.gen(function* () {
          const progress = { ...initial, results: [...initial.results] };
          let failed = false;
          const datasets = definition.datasets.length ? definition.datasets : [{}];
          for (const [dataset, row] of datasets.entries()) {
            const variables: Record<string, string> = Object.assign({}, row);
            for (const step of definition.steps) {
              if (token.cancelled || (failed && definition.failurePolicy === "stop")) break;
              const environment = yield* getEnvironment(
                { ...input, source },
                m,
                yield* stateFor(m.id),
                (yield* dev.snapshot(input)).root,
              );
              let raw: DevHttpExchange | undefined;
              const outcome = yield* executeRun(
                {
                  threadId: input.threadId,
                  workspaceId: m.id,
                  requestKey: step.requestKey,
                  source,
                  expectedRevision: revision,
                  environmentRevision: environment.revision,
                  requestId: `workflow:${digest(`${input.runId}:${dataset}:${step.id}`)}`,
                },
                caller,
                {
                  variables,
                  capture: (value) => {
                    raw = value;
                  },
                },
              ).pipe(Effect.result);
              if (Result.isFailure(outcome)) {
                progress.results.push({
                  stepId: step.id,
                  name: step.name,
                  dataset,
                  result: null,
                  error: outcome.failure.message,
                });
                failed = true;
              } else {
                const result = outcome.success;
                const checks = raw ? workflowChecks(raw, step.assertions) : [];
                for (const capture of step.captures) {
                  const value = raw ? workflowValue(raw, capture.source, capture.path) : undefined;
                  if (value === undefined || value === null)
                    checks.push({ name: `Capture ${capture.key}`, passed: false });
                  else
                    variables[capture.key] =
                      typeof value === "string" ? value : stringifyJson(value);
                }
                const combined = {
                  ...result,
                  exchange: redactExchangeSecrets(result.exchange, Object.values(variables)),
                  checks: [...result.checks, ...checks],
                };
                failed ||=
                  Boolean(result.exchange.error) ||
                  (result.exchange.status ?? 0) >= 400 ||
                  combined.checks.some((c) => !c.passed);
                progress.results.push({
                  stepId: step.id,
                  name: step.name,
                  dataset,
                  result: combined,
                  error: null,
                });
              }
              yield* saveRun(m.id, {
                ...progress,
                state: token.cancelled ? "stopping" : "running",
              });
            }
            if (token.cancelled || (failed && definition.failurePolicy === "stop")) break;
          }
          yield* saveRun(m.id, {
            ...progress,
            state: token.cancelled ? "cancelled" : failed ? "failed" : "passed",
          });
        }).pipe(
          Effect.catch(() =>
            readRun(m.id, initial.id).pipe(
              Effect.flatMap((value) => saveRun(m.id, { ...value, state: "interrupted" })),
              Effect.orElseSucceed(() => undefined),
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              activeRuns.delete(key);
            }),
          ),
        );
        yield* execute.pipe(Effect.forkIn(scope));
      }
    } else if (input.action === "read" || input.action === "cancel") {
      if (!input.runId) return yield* new DevApiError({ reason: "invalid-format" });
      current = yield* readRun(m.id, input.runId);
      const active = activeRuns.get(key);
      if ((current.state === "running" || current.state === "stopping") && !active)
        current = { ...current, state: "interrupted" };
      if ((current.state === "running" || current.state === "stopping") && active?.cancelled)
        current = { ...current, state: "stopping" };
      if (
        input.action === "cancel" &&
        active &&
        (current.state === "running" || current.state === "stopping")
      ) {
        active.cancelled = true;
        current = { ...current, state: "stopping" };
        yield* PubSub.publish(updates, { workspaceId: m.id, progress: progressFor(current) });
      }
    }
    if (current && ["running", "stopping"].includes(current.state) && !activeRuns.has(key))
      current = { ...current, state: "interrupted" };
    return {
      revision: revisionFor(m, yield* stateFor(m.id)),
      workflows: m.workflows ?? [],
      runs: (yield* runIndex(m.id))
        .slice(0, 40)
        .map((entry) =>
          (entry.state === "running" || entry.state === "stopping") &&
          !activeRuns.has(`${m.id}:${entry.id}`)
            ? { ...entry, state: "interrupted" as const }
            : entry,
        ),
      run: current,
    };
  }, workflowGate.withPermit);
  const saveRequest = Effect.fn("DevApi.saveRequest")(function* (input: DevApiSaveRequest) {
    const { root } = yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId);
    const state = yield* stateFor(m.id);
    if (revisionFor(m, state) !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    yield* native(m, input.requestKey, input.sourceJson);
    yield* save(m.id, {
      ...state,
      ...(m.editBase ? { editBase: m.editBase } : {}),
      requestEdits: { ...activeEdits(m, state), [input.requestKey]: input.sourceJson },
    });
    return yield* details(input, m, root);
  }, gate.withPermit);
  const exportWorkspace = Effect.fn("DevApi.exportFiles")(function* (input: DevApiWorkspaceTarget) {
    yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId);
    const state = yield* stateFor(m.id);
    const files: Array<{ name: string; content: string }> = [];
    for (const file of m.files) {
      const original = yield* fs
        .readFileString(fileFor(m.id, `${file.hash}.json`))
        .pipe(Effect.mapError(storageError));
      const parsed = yield* Effect.try({
        try: () => importHoppscotch(original, file.name),
        catch: () => new DevApiError({ reason: "invalid-format" }),
      });
      const content =
        parsed.kind === "collections"
          ? yield* Effect.try({
              try: () => applyRequestEdits(original, file.name, activeEdits(m, state)),
              catch: () => new DevApiError({ reason: "invalid-format" }),
            })
          : portableEnvironmentExport(parsed.source, file.name, m, state);
      const safe = yield* Effect.try({
        try: () => portableApiJson(content),
        catch: () => new DevApiError({ reason: "invalid-format" }),
      });
      files.push({ name: file.name, content: safe });
    }
    return { files };
  });
  const forkWorkspace = Effect.fn("DevApi.forkWorkspace")(function* (
    input: DevApiWorkspaceTarget & { expectedRevision: string; requestId: string },
  ) {
    const { root } = yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId);
    const state = yield* stateFor(m.id);
    if (revisionFor(m, state) !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const { library: _library, ...original } = m;
    const id = fingerprint({ original: m.id, requestId: input.requestId }).slice(0, 24);
    const next = { ...original, id, name: `${m.name} (local copy)` };
    for (const file of m.files)
      yield* write(
        fileFor(id, `${file.hash}.json`),
        yield* fs
          .readFileString(fileFor(m.id, `${file.hash}.json`))
          .pipe(Effect.mapError(storageError)),
      );
    yield* save(id, { ...state, receipts: [] });
    yield* write(
      fileFor(id, "manifest.json"),
      yield* encodeManifest(next).pipe(Effect.mapError(storageError)),
    );
    return yield* details({ ...input, workspaceId: id }, next, root);
  }, gate.withPermit);
  const bundle = Effect.fn("DevApi.bundle")(function* (
    input: DevApiWorkspaceTarget & { expectedRevision?: string },
  ) {
    const m = yield* readManifest(input.workspaceId);
    if (input.expectedRevision && revisionFor(m, yield* stateFor(m.id)) !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const exported = yield* exportWorkspace(input);
    return {
      id: m.library?.sharedId ?? m.id,
      name: m.name,
      files: exported.files,
      workflows: portableApiWorkflows(m.workflows ?? []),
      folders: m.folders ?? [],
    };
  }, gate.withPermit);
  const markShared = Effect.fn("DevApi.markShared")(function* (
    input: DevApiWorkspaceTarget & { expectedRevision: string; binding: DevApiLibraryBinding },
  ) {
    const { root } = yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId);
    const revision = revisionFor(m, yield* stateFor(m.id));
    if (revision !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    const next = { ...m, library: { ...input.binding, baseRevision: revision } };
    yield* write(
      fileFor(m.id, "manifest.json"),
      yield* encodeManifest(next).pipe(Effect.mapError(storageError)),
    );
    return yield* details(input, next, root);
  }, gate.withPermit);
  const installBundle = Effect.fn("DevApi.installBundle")(function* (
    input: DevTarget & {
      expectedRevision?: string;
      requestId: string;
      bundle: LibraryApiBundle;
      binding: DevApiLibraryBinding;
    },
  ) {
    return yield* importWorkspace(
      { threadId: input.threadId, name: input.bundle.name, files: input.bundle.files },
      {
        bundle: input.bundle,
        requestId: input.requestId,
        binding: input.binding,
        ...(input.expectedRevision ? { expectedRevision: input.expectedRevision } : {}),
      },
    );
  });
  const remove = Effect.fn("DevApi.remove")(function* (input: DevApiWorkspaceTarget) {
    yield* dev.snapshot(input);
    const requireStopped = Effect.suspend(() =>
      [...activeRuns.keys()].some((key) => key.startsWith(`${input.workspaceId}:`))
        ? Effect.fail(new DevApiError({ reason: "workflow-active" }))
        : Effect.void,
    );
    yield* requireStopped;
    yield* gate.withPermit(
      Effect.gen(function* () {
        yield* requireStopped;
        yield* readManifest(input.workspaceId);
        yield* fs
          .remove(location(input.workspaceId)!, { recursive: true })
          .pipe(Effect.mapError(storageError));
      }),
    );
  });
  return DevApiService.of({
    list,
    forkWorkspace,
    bundle,
    markShared,
    installBundle,
    author,
    workflow,
    watchWorkflow,
    import: importWorkspace,
    importDirectory,
    read,
    environment,
    saveEnvironment,
    saveRequest,
    export: Effect.fn("DevApi.export")(
      (input: DevApiWorkspaceTarget) => exportWorkspace(input),
      gate.withPermit,
    ),
    run,
    remove,
  });
});
export const layer = Layer.effect(DevApiService, make);
