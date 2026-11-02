// @effect-diagnostics nodeBuiltinImport:off -- Content digests pin imports and dotenv revisions; Node parses dotenv without evaluating it.
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { stableStringify } from "@t3tools/shared/relaySigning";
import {
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
import { API_SCRIPT_RUNNER } from "./apiScriptRunner.ts";
import {
  HoppscotchInputError,
  applyRequestEdits,
  importHoppscotch,
  prepareHoppscotchRequest,
  type NativeRequest,
} from "./hoppscotch.ts";
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
  dotenvBindings: Schema.optionalKey(Schema.Record(Schema.String, Schema.Array(DevApiVariable))),
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
const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(Manifest));
const encodeState = Schema.encodeEffect(Schema.fromJsonString(State));
const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(Manifest));
const decodeState = Schema.decodeEffect(Schema.fromJsonString(State));
const decodeScript = Schema.decodeEffect(Schema.fromJsonString(ScriptResult));
type State = typeof State.Type;
type Manifest = typeof Manifest.Type;
type Failure = DevApiError | DevEnvironmentError | DevHttpError | VaultError;
const decodeUnknownRequest = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
function portableNativeExport(text: string): string {
  const walk = (value: unknown, key: string = ""): unknown => {
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (object.secret === true && typeof object.key === "string")
      return { ...object, initialValue: "", currentValue: "", value: "", vault: undefined };
    return Object.fromEntries(
      Object.entries(object).map(([name, value]) => [
        name,
        key === "auth" &&
        ["token", "password", "value"].includes(name) &&
        typeof value === "string" &&
        !value.includes("<<")
          ? ""
          : walk(value, name),
      ]),
    );
  };
  return JSON.stringify(walk(JSON.parse(text)), null, 2);
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
    const variables =
      state.environments[id] ?? manifest.environments.find((e) => e.id === id)?.variables ?? [];
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
  const revisionFor = (m: Manifest, state: State) =>
    fingerprint({ manifest: m, requestEdits: state.requestEdits ?? {} });
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
    const edits = { ...state.requestEdits, ...(override === undefined ? {} : { [key]: override }) };
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
      const variables = state.environments[source.id] ?? source.variables;
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
      revision: revisionFor(m, yield* stateFor(m.id)),
      requests: m.requests.map(({ file: _file, ...r }) => {
        const edited = state.requestEdits?.[r.id];
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
      result.push(summary(yield* readManifest(id)));
    return result.toSorted((a, b) => a.name.localeCompare(b.name));
  });
  const read = Effect.fn("DevApi.read")(function* (input: DevApiRead) {
    const { root } = yield* dev.snapshot(input);
    return yield* details(input, yield* readManifest(input.workspaceId), root);
  });
  const importWorkspace = Effect.fn("DevApi.import")(function* (input: DevApiImport) {
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
    const id = fingerprint({
      name: input.name,
      files: input.files
        .map((f) => ({ name: f.name, hash: digest(f.content) }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    }).slice(0, 24);
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
    const m: Manifest = {
      version: 1,
      id,
      name: input.name,
      files,
      requests: entries,
      environments,
    };
    for (const file of input.files)
      yield* write(fileFor(id, `${digest(file.content)}.json`), file.content);
    yield* write(
      fileFor(id, "manifest.json"),
      yield* encodeManifest(m).pipe(Effect.mapError(storageError)),
    );
    return yield* details({ ...input, workspaceId: id }, m, root);
  }, gate.withPermit);
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
      yield* save(m.id, {
        ...state,
        environments: { ...state.environments, [input.source.id]: variables },
      });
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
  const run = Effect.fn("DevApi.run")(function* (
    input: DevApiRun,
    caller?: DevApiCredentials.ApiCredentialCaller,
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
      const bound = env.variables.filter((v) => v.vault);
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
      const sensitiveValues = Object.values(privateValues);
      Object.assign(values, privateValues);
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
      if (input.source.kind !== "none") {
        if (input.source.kind === "json")
          pending = {
            ...pending,
            environments: { ...pending.environments, [input.source.id]: beforeVars },
          };
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
        input.source.kind !== "none" &&
        latestEnv.revision === preparedEnvironment.revision &&
        validateVariables(vars);
      let next = pending;
      if (environmentUpdated) {
        if (input.source.kind === "json")
          next = { ...next, environments: { ...next.environments, [input.source.id]: vars } };
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
  const saveRequest = Effect.fn("DevApi.saveRequest")(function* (input: DevApiSaveRequest) {
    const { root } = yield* dev.snapshot(input);
    const m = yield* readManifest(input.workspaceId);
    const state = yield* stateFor(m.id);
    if (revisionFor(m, state) !== input.expectedRevision)
      return yield* new DevApiError({ reason: "revision-conflict" });
    yield* native(m, input.requestKey, input.sourceJson);
    yield* save(m.id, {
      ...state,
      requestEdits: { ...state.requestEdits, [input.requestKey]: input.sourceJson },
    });
    return yield* details(input, m, root);
  }, gate.withPermit);
  const exportWorkspace = Effect.fn("DevApi.export")(function* (input: DevApiWorkspaceTarget) {
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
              try: () => applyRequestEdits(original, file.name, state.requestEdits ?? {}),
              catch: () => new DevApiError({ reason: "invalid-format" }),
            })
          : portableEnvironmentExport(parsed.source, file.name, m, state);
      const safe = yield* Effect.try({
        try: () => portableNativeExport(content),
        catch: () => new DevApiError({ reason: "invalid-format" }),
      });
      files.push({ name: file.name, content: safe });
    }
    return { files };
  });
  const remove = Effect.fn("DevApi.remove")(function* (input: DevApiWorkspaceTarget) {
    yield* dev.snapshot(input);
    yield* readManifest(input.workspaceId);
    yield* fs
      .remove(location(input.workspaceId)!, { recursive: true })
      .pipe(Effect.mapError(storageError));
  }, gate.withPermit);
  return DevApiService.of({
    list,
    import: importWorkspace,
    importDirectory,
    read,
    environment,
    saveEnvironment,
    saveRequest,
    export: exportWorkspace,
    run,
    remove,
  });
});
export const layer = Layer.effect(DevApiService, make);
