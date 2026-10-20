// @effect-diagnostics nodeBuiltinImport:off -- the feature list checks the weights synchronously at startup, and the model loads into a worker thread.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeWorkerThreads from "node:worker_threads";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { isLibraryAuthorityEnv } from "./authority.ts";

/**
 * Local sentence embeddings for semantic history search.
 *
 * The model is all-MiniLM-L6-v2 (Apache-2.0), as quantized to ONNX by Xenova, pinned by
 * revision and sha256. Weights are never downloaded by the server: the Library image places
 * them in the directory named by `LOOM_LIBRARY_EMBEDDINGS_DIR`. Without that directory, or with
 * files that fail their hash, semantic search stays off and full-text search is unchanged.
 *
 * Inference runs on onnxruntime-web's WebAssembly build rather than onnxruntime-node. The WASM
 * build is one platform-independent 14 MB binary with no native addon, so it loads from the
 * standalone runtime archive on any glibc or musl Linux without a prebuild matrix, and it adds
 * nothing to the desktop app. onnxruntime-node ships 300 MB of per-platform native libraries.
 * It runs single-threaded in a worker thread, so an inference (5 ms for a query, 80 ms for a full
 * 128 tokens) never blocks the event loop that serves the Library. Once loaded it holds about
 * 250 MB for the life of the process; restarting the worker to give it back fragments the heap
 * and grows the process instead.
 */

export const LIBRARY_EMBEDDINGS_DIR_ENV = "LOOM_LIBRARY_EMBEDDINGS_DIR";

/** The pinned model. Changing it re-embeds the Library, because stored vectors carry its id. */
export const LIBRARY_EMBEDDING_MODEL = {
  id: "Xenova/all-MiniLM-L6-v2@751bff37182d3f1213fa05d7196b954e230abad9",
  dimensions: 384,
  files: {
    model: {
      name: "model_quantized.onnx",
      sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
    },
    tokenizer: {
      name: "tokenizer.json",
      sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    },
  },
} as const;

// The model was trained on 128-token inputs; longer inputs cost quadratically more and add little.
export const LIBRARY_EMBEDDING_MAX_TOKENS = 128;
// About four characters per token; enough to fill the token budget without tokenizing a long paste.
export const LIBRARY_EMBEDDING_MAX_CHARS = 2000;
const MAX_WORD_CHARS = 100;

export class LibraryEmbedderError extends Schema.TaggedError<LibraryEmbedderError>()(
  "LibraryEmbedderError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The semantic search model could not run.";
  }
}

export interface LibraryEmbedderShape {
  /** Stored with every vector, so vectors from another model are never compared. */
  readonly model: string;
  /** A unit-length vector for the start of `text`. */
  readonly embed: (text: string) => Effect.Effect<Float32Array, LibraryEmbedderError>;
}

export interface LibraryEmbeddingFiles {
  readonly directory: string;
  /** The resolved onnxruntime-web entry point. */
  readonly runtime: string;
}

const requireForRuntime = NodeModule.createRequire(import.meta.url);

const sha256File = (path: string) =>
  NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(path)).digest("hex");

/**
 * Where semantic search loads from on this server, or why it is off. Only a Library authority with
 * a weights directory whose files match their pinned hashes, and with the runtime installed, turns
 * it on. Reads the files once per process.
 */
export function resolveLibraryEmbeddingFiles(
  env: Readonly<Record<string, string | undefined>>,
): { readonly files: LibraryEmbeddingFiles } | { readonly off: string } {
  if (!isLibraryAuthorityEnv(env)) return { off: "not a Library authority" };
  const directory = env[LIBRARY_EMBEDDINGS_DIR_ENV]?.trim();
  if (!directory) return { off: `${LIBRARY_EMBEDDINGS_DIR_ENV} is not set` };
  for (const file of Object.values(LIBRARY_EMBEDDING_MODEL.files)) {
    const path = NodePath.join(directory, file.name);
    let actual: string;
    try {
      actual = sha256File(path);
    } catch {
      return { off: `${path} is missing or unreadable` };
    }
    if (actual !== file.sha256) return { off: `${path} does not match its pinned sha256` };
  }
  let runtime: string;
  try {
    runtime = requireForRuntime.resolve("onnxruntime-web");
  } catch {
    return { off: "onnxruntime-web is not installed beside this server" };
  }
  return { files: { directory, runtime } };
}

let configured: ReturnType<typeof resolveLibraryEmbeddingFiles> | undefined;
/** `resolveLibraryEmbeddingFiles` for this process's environment, read once. */
export const libraryEmbeddingConfiguration = () =>
  (configured ??= resolveLibraryEmbeddingFiles(process.env));

/** Say why semantic search is off when a weights directory was configured but not usable. */
export const warnIfLibraryEmbeddingsUnusable = Effect.suspend(() => {
  const configuration = libraryEmbeddingConfiguration();
  return "off" in configuration && process.env[LIBRARY_EMBEDDINGS_DIR_ENV]
    ? Effect.logWarning(`Semantic search is off: ${configuration.off}`)
    : Effect.void;
});

// BERT's CJK ideograph blocks. Each ideograph is a word of its own.
const CJK =
  /[\u{4E00}-\u{9FFF}\u{3400}-\u{4DBF}\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}\u{F900}-\u{FAFF}\u{2F800}-\u{2FA1F}]/u;
const PUNCTUATION = /[!-/:-@[-`{-~]|\p{P}/u;
const WHITESPACE = /\s/u;
const CONTROL = /\p{C}/u;

/**
 * The model's uncased BERT WordPiece tokenizer: drop control characters, lowercase, strip
 * accents, split on whitespace and punctuation, then match the longest vocabulary pieces.
 * Returns token ids framed by `[CLS]` and `[SEP]`, at most `maxTokens` of them.
 */
export function makeWordPieceTokenizer(vocab: ReadonlyMap<string, number>) {
  const special = (token: string) => {
    const id = vocab.get(token);
    if (id === undefined) throw new Error(`Tokenizer vocabulary has no ${token}`);
    return id;
  };
  const cls = special("[CLS]");
  const sep = special("[SEP]");
  const unknown = special("[UNK]");
  const words = (text: string) => {
    const result: string[] = [];
    let word = "";
    const flush = () => {
      if (word !== "") result.push(word);
      word = "";
    };
    const normalized = text
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "")
      .toLowerCase();
    for (const character of normalized) {
      if (WHITESPACE.test(character)) flush();
      else if (character === "�" || CONTROL.test(character)) continue;
      else if (PUNCTUATION.test(character) || CJK.test(character)) {
        flush();
        result.push(character);
      } else word += character;
    }
    flush();
    return result;
  };
  const pieces = (word: string): number[] => {
    const characters = Array.from(word);
    if (characters.length > MAX_WORD_CHARS) return [unknown];
    const ids: number[] = [];
    let start = 0;
    while (start < characters.length) {
      let end = characters.length;
      let id: number | undefined;
      while (start < end) {
        const piece = characters.slice(start, end).join("");
        id = vocab.get(start === 0 ? piece : `##${piece}`);
        if (id !== undefined) break;
        end -= 1;
      }
      if (id === undefined) return [unknown];
      ids.push(id);
      start = end;
    }
    return ids;
  };
  return (text: string, maxTokens = LIBRARY_EMBEDDING_MAX_TOKENS): number[] => {
    const ids = [cls];
    for (const word of words(text)) {
      for (const id of pieces(word)) {
        if (ids.length === maxTokens - 1) break;
        ids.push(id);
      }
      if (ids.length === maxTokens - 1) break;
    }
    ids.push(sep);
    return ids;
  };
}

export function readWordPieceVocabulary(tokenizerJson: string): ReadonlyMap<string, number> {
  const parsed = JSON.parse(tokenizerJson) as { model?: { type?: string; vocab?: unknown } };
  const vocab = parsed.model?.vocab;
  if (parsed.model?.type !== "WordPiece" || vocab === null || typeof vocab !== "object")
    throw new Error("tokenizer.json is not a WordPiece tokenizer");
  return new Map(
    Object.entries(vocab).filter((entry): entry is [string, number] => Number.isInteger(entry[1])),
  );
}

/**
 * Runs the model off the main thread. Receives token ids and returns the mean-pooled, unit-length
 * embedding. The runtime is required by absolute path through `createRequire`, which reads the
 * real filesystem from inside the single-executable archive; its WASM glue then loads beside it.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { createRequire } = require("node:module");
const ort = createRequire(workerData.runtime)(workerData.runtime);
ort.env.wasm.numThreads = 1;
const ready = ort.InferenceSession.create(new Uint8Array(workerData.model));
const run = async ({ ids }) => {
  const session = await ready;
  const n = ids.length;
  const tensors = {
    input_ids: BigInt64Array.from(ids, BigInt),
    attention_mask: new BigInt64Array(n).fill(1n),
    token_type_ids: new BigInt64Array(n),
  };
  const feeds = {};
  for (const name of session.inputNames) feeds[name] = new ort.Tensor("int64", tensors[name], [1, n]);
  const results = await session.run(feeds);
  const output = results[session.outputNames[0]];
  const width = output.dims[2];
  const vector = new Float32Array(width);
  for (let token = 0; token < n; token++)
    for (let index = 0; index < width; index++) vector[index] += output.data[token * width + index];
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < width; index++) vector[index] /= norm;
  for (const tensor of Object.values(results)) tensor.dispose?.();
  return vector;
};
parentPort.on("message", (request) => {
  run(request).then(
    (vector) => parentPort.postMessage({ id: request.id, vector }, [vector.buffer]),
    (error) => parentPort.postMessage({ id: request.id, error: String(error && error.message || error) }),
  );
});
`;

type WorkerReply =
  | { readonly id: number; readonly vector: Float32Array }
  | { readonly id: number; readonly error: string };

/**
 * The real embedder for verified files. Nothing loads until the first `embed`: the tokenizer and
 * model are read and checked against their hashes again, then the worker starts. The worker is
 * unreferenced, so it never keeps the process alive.
 */
export function makeOnnxLibraryEmbedder(files: LibraryEmbeddingFiles): LibraryEmbedderShape {
  let loaded:
    | Promise<{
        tokenize: ReturnType<typeof makeWordPieceTokenizer>;
        worker: NodeWorkerThreads.Worker;
      }>
    | undefined;
  const waiting = new Map<number, (reply: WorkerReply) => void>();
  let nextId = 0;
  const load = () =>
    (loaded ??= Promise.resolve()
      .then(() => {
        const read = (file: { readonly name: string; readonly sha256: string }) => {
          const bytes = NodeFS.readFileSync(NodePath.join(files.directory, file.name));
          if (NodeCrypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256)
            throw new Error(`${file.name} does not match its pinned sha256`);
          return bytes;
        };
        const tokenize = makeWordPieceTokenizer(
          readWordPieceVocabulary(read(LIBRARY_EMBEDDING_MODEL.files.tokenizer).toString("utf8")),
        );
        const model = read(LIBRARY_EMBEDDING_MODEL.files.model);
        const buffer = model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength);
        const worker = new NodeWorkerThreads.Worker(WORKER_SOURCE, {
          eval: true,
          workerData: { runtime: files.runtime, model: buffer },
          transferList: [buffer],
        });
        worker.unref();
        worker.on("message", (reply: WorkerReply) => {
          waiting.get(reply.id)?.(reply);
          waiting.delete(reply.id);
        });
        const fail = (error: unknown) => {
          // Later calls load again rather than reuse a dead worker.
          loaded = undefined;
          for (const [id, resolve] of waiting) resolve({ id, error: String(error) });
          waiting.clear();
        };
        worker.on("error", fail);
        worker.on("exit", (code) => fail(new Error(`embedding worker exited with code ${code}`)));
        return { tokenize, worker };
      })
      .catch((error: unknown) => {
        // A failed load is tried again by the next call.
        loaded = undefined;
        throw error;
      }));
  const embed = (text: string) =>
    load().then(
      ({ tokenize, worker }) =>
        new Promise<Float32Array>((resolve, reject) => {
          const id = nextId++;
          waiting.set(id, (reply) =>
            "vector" in reply ? resolve(reply.vector) : reject(new Error(reply.error)),
          );
          const ids = Int32Array.from(tokenize(text.slice(0, LIBRARY_EMBEDDING_MAX_CHARS)));
          worker.postMessage({ id, ids }, [ids.buffer]);
        }),
    );
  return {
    model: LIBRARY_EMBEDDING_MODEL.id,
    embed: (text) =>
      Effect.tryPromise({
        try: () => embed(text),
        catch: (cause) => new LibraryEmbedderError({ cause }),
      }),
  };
}

/**
 * The embedder semantic search uses, or null when it is off. Defaults to the pinned model when
 * this server is configured for it; tests substitute a deterministic one.
 */
export const LibraryEmbedder = Context.Reference<LibraryEmbedderShape | null>(
  "server/fork/project-library/LibraryEmbedder",
  {
    defaultValue: () => {
      const configuration = libraryEmbeddingConfiguration();
      return "files" in configuration ? makeOnnxLibraryEmbedder(configuration.files) : null;
    },
  },
);
