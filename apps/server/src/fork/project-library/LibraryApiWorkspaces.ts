// @effect-diagnostics nodeBuiltinImport:off -- Content hashes pin API definitions and idempotent mutation receipts.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  LibraryApiBundle,
  LibraryApiCatalog,
  LibraryError,
  type LibraryApiRequest,
} from "@t3tools/contracts/fork";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { ServerConfig } from "../../config.ts";
import { LibraryService } from "./LibraryService.ts";
import { portableApiJson, portableApiWorkflows } from "../browser-dev-tools/apiPortable.ts";
import { importHoppscotch } from "../browser-dev-tools/hoppscotch.ts";
const StoredResult = Schema.Struct({
  ...LibraryApiCatalog.fields,
  selected: Schema.NullOr(Schema.String),
});
const decodeBundle = Schema.decodeEffect(Schema.fromJsonString(LibraryApiBundle));
const encodeBundle = Schema.encodeEffect(Schema.fromJsonString(LibraryApiBundle));
const Stored = Schema.Struct({
  versions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
  entries: Schema.Array(Schema.Struct({ revision: Schema.Int, bundle: LibraryApiBundle })),
  receipts: Schema.Array(
    Schema.Struct({ id: Schema.String, fingerprint: Schema.String, result: StoredResult }),
  ),
});
const decode = Schema.decodeEffect(Schema.fromJsonString(Stored));
const encode = Schema.encodeEffect(Schema.fromJsonString(Stored));
const digest = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(stableStringify(value)).digest("hex");
export class LibraryApiWorkspaces extends Context.Service<
  LibraryApiWorkspaces,
  { readonly execute: (input: LibraryApiRequest) => Effect.Effect<LibraryApiCatalog, LibraryError> }
>()("t3/fork/project-library/LibraryApiWorkspaces") {}
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const library = yield* LibraryService;
  const gate = yield* Semaphore.make(1);
  const execute = Effect.fn("LibraryApiWorkspaces.execute")(function* (input: LibraryApiRequest) {
    if (!(yield* library.info).isAuthority)
      return yield* new LibraryError({ reason: "not-authority" });
    const project = yield* library.project({ projectId: input.projectId });
    if (project.archived && input.action !== "list" && input.action !== "read")
      return yield* new LibraryError({
        reason: "blocked",
        detail: "Reopen this project before changing its API workspaces.",
      });
    const file = path.join(
      config.stateDir,
      "fork",
      "library-api-workspaces",
      `${digest(input.projectId)}.json`,
    );
    const state = yield* fs.readFileString(file).pipe(
      Effect.flatMap(decode),
      Effect.catchIf(
        (e) => e._tag === "PlatformError" && e.reason._tag === "NotFound",
        () => Effect.succeed({ entries: [], receipts: [] } as typeof Stored.Type),
      ),
      Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
    );
    const id = input.workspaceId ?? input.bundle?.id;
    const entry = state.entries.find((e) => e.bundle.id === id);
    const currentRevision = id ? (state.versions?.[id] ?? entry?.revision ?? 0) : 0;
    const read = (): LibraryApiCatalog => ({
      projectId: input.projectId,
      entries: state.entries.map((e) => ({
        id: e.bundle.id,
        name: e.bundle.name,
        revision: e.revision,
      })),
      revision: currentRevision,
      selected: input.action === "list" ? null : (entry?.bundle ?? null),
    });
    if (input.action === "list" || input.action === "read") return read();
    if (!input.requestId || !id) return yield* new LibraryError({ reason: "invalid" });
    const fingerprint = digest(input);
    const receipt = state.receipts.find((r) => r.id === input.requestId);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        return yield* new LibraryError({ reason: "request-conflict" });
      const selected = receipt.result.selected
        ? yield* fs.readFileString(`${file}.${receipt.result.selected}`).pipe(
            Effect.flatMap(decodeBundle),
            Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
          )
        : null;
      return { ...receipt.result, selected };
    }
    if (currentRevision !== input.expectedRevision)
      return yield* new LibraryError({ reason: "revision-conflict" });
    let entries = state.entries.filter((e) => e.bundle.id !== id);
    if (input.action === "save") {
      if (!input.bundle || input.bundle.id !== id)
        return yield* new LibraryError({ reason: "invalid" });
      const bundle = yield* Effect.try({
        try: () => {
          const files = input.bundle!.files.map((f) => {
            if (!/^[^/\\\0]+\.json$/.test(f.name)) throw new Error("Invalid filename");
            const content = portableApiJson(f.content);
            importHoppscotch(content, f.name);
            return { name: f.name, content };
          });
          if (new Set(files.map((f) => f.name)).size !== files.length)
            throw new Error("Duplicate files");
          return {
            ...input.bundle!,
            files,
            workflows: portableApiWorkflows(input.bundle!.workflows),
          };
        },
        catch: (cause) => new LibraryError({ reason: "invalid", cause }),
      });
      entries = [...entries, { revision: currentRevision + 1, bundle }];
      if (entries.length > 32 || stableStringify(entries).length > 16777216)
        return yield* new LibraryError({
          reason: "invalid",
          detail: "This project's shared API definitions exceed 16 MiB.",
        });
    }
    const selected = entries.find((e) => e.bundle.id === id);
    const result: LibraryApiCatalog = {
      projectId: input.projectId,
      entries: entries.map((e) => ({ id: e.bundle.id, name: e.bundle.name, revision: e.revision })),
      revision: currentRevision + 1,
      selected: selected?.bundle ?? null,
    };
    const selectedHash = result.selected ? digest(result.selected) : null;
    const next = {
      versions: { ...state.versions, [id]: currentRevision + 1 },
      entries,
      receipts: [
        ...state.receipts.slice(-19),
        { id: input.requestId, fingerprint, result: { ...result, selected: selectedHash } },
      ],
    };
    yield* fs
      .makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 })
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
    if (result.selected && selectedHash)
      yield* writeFileStringAtomically({
        filePath: `${file}.${selectedHash}`,
        contents: yield* encodeBundle(result.selected).pipe(
          Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
        ),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
      );
    yield* writeFileStringAtomically({
      filePath: file,
      contents: yield* encode(next).pipe(
        Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
      ),
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError((cause) => new LibraryError({ reason: "io", cause })),
    );
    yield* fs
      .chmod(file, 0o600)
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })));
    const retained = new Set(next.receipts.map((r) => r.result.selected).filter(Boolean));
    const prefix = `${path.basename(file)}.`;
    for (const name of yield* fs
      .readDirectory(path.dirname(file))
      .pipe(Effect.mapError((cause) => new LibraryError({ reason: "io", cause })))) {
      if (
        name.startsWith(prefix) &&
        /^[a-f\d]{64}$/.test(name.slice(prefix.length)) &&
        !retained.has(name.slice(prefix.length))
      )
        yield* fs
          .remove(path.join(path.dirname(file), name))
          .pipe(Effect.orElseSucceed(() => undefined));
    }
    return result;
  }, gate.withPermit);
  return LibraryApiWorkspaces.of({ execute });
});
export const layer = Layer.effect(LibraryApiWorkspaces, make);
