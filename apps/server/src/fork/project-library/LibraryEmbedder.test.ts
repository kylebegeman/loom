// @effect-diagnostics nodeBuiltinImport:off -- the configuration under test reads files synchronously.
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  LIBRARY_EMBEDDING_MODEL,
  makeOnnxLibraryEmbedder,
  makeWordPieceTokenizer,
  readWordPieceVocabulary,
  resolveLibraryEmbeddingFiles,
} from "./LibraryEmbedder.ts";

// A directory holding the pinned model's files, for the tests that run the real model.
const realModelDirectory = process.env.LOOM_TEST_EMBEDDINGS_DIR;

const vocab = new Map(
  [
    "[PAD]",
    "[UNK]",
    "[CLS]",
    "[SEP]",
    "the",
    "roll",
    "##out",
    "stall",
    "##ed",
    ",",
    "?",
    "cafe",
    "中",
    "文",
  ].map((token, id) => [token, id]),
);
const tokenize = makeWordPieceTokenizer(vocab);
const tokens = (text: string, maxTokens?: number) =>
  tokenize(text, maxTokens).map((id) => [...vocab.keys()][id]);

describe("Library embedding tokenizer", () => {
  it("lowercases, strips accents, splits punctuation and matches word pieces", () => {
    expect(tokens("The ROLLOUT stalled?")).toEqual([
      "[CLS]",
      "the",
      "roll",
      "##out",
      "stall",
      "##ed",
      "?",
      "[SEP]",
    ]);
    expect(tokens("Café,\u0000 rollouts 中文")).toEqual([
      "[CLS]",
      "cafe",
      ",",
      "[UNK]",
      "中",
      "文",
      "[SEP]",
    ]);
    expect(tokens(`${"a".repeat(101)} the`)).toEqual(["[CLS]", "[UNK]", "the", "[SEP]"]);
  });

  it("frames at most the token budget", () => {
    expect(tokens("the the the the the", 4)).toEqual(["[CLS]", "the", "the", "[SEP]"]);
    expect(tokens("rollout rollout", 4)).toEqual(["[CLS]", "roll", "##out", "[SEP]"]);
  });

  it("reads a WordPiece vocabulary and rejects anything else", () => {
    expect(
      readWordPieceVocabulary(
        JSON.stringify({ model: { type: "WordPiece", vocab: { a: 0, b: 1 } } }),
      ),
    ).toEqual(
      new Map([
        ["a", 0],
        ["b", 1],
      ]),
    );
    expect(() =>
      readWordPieceVocabulary(JSON.stringify({ model: { type: "BPE", vocab: {} } })),
    ).toThrow();
  });
});

describe("Library embedding configuration", () => {
  it("stays off unless an authority has the pinned files", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-embeddings-"));
    try {
      const authority = { LOOM_LIBRARY_AUTHORITY: "true", LOOM_LIBRARY_EMBEDDINGS_DIR: directory };
      expect(resolveLibraryEmbeddingFiles({ LOOM_LIBRARY_EMBEDDINGS_DIR: directory })).toEqual({
        off: "not a Library authority",
      });
      expect(resolveLibraryEmbeddingFiles({ LOOM_LIBRARY_AUTHORITY: "true" })).toEqual({
        off: "LOOM_LIBRARY_EMBEDDINGS_DIR is not set",
      });
      expect(resolveLibraryEmbeddingFiles(authority)).toMatchObject({
        off: expect.stringContaining("is missing or unreadable"),
      });
      for (const file of Object.values(LIBRARY_EMBEDDING_MODEL.files))
        NodeFS.writeFileSync(NodePath.join(directory, file.name), "not the model");
      expect(resolveLibraryEmbeddingFiles(authority)).toMatchObject({
        off: expect.stringContaining("does not match its pinned sha256"),
      });
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!realModelDirectory)("Library embedding with the pinned model", () => {
  const files = () => {
    const resolved = resolveLibraryEmbeddingFiles({
      LOOM_LIBRARY_AUTHORITY: "true",
      LOOM_LIBRARY_EMBEDDINGS_DIR: realModelDirectory,
    });
    if (!("files" in resolved)) throw new Error(resolved.off);
    return resolved.files;
  };

  it("tokenizes as the model's own tokenizer does", () => {
    const real = makeWordPieceTokenizer(
      readWordPieceVocabulary(
        NodeFS.readFileSync(NodePath.join(files().directory, "tokenizer.json"), "utf8"),
      ),
    );
    expect(real("Hello, world!")).toEqual([101, 7592, 1010, 2088, 999, 102]);
  });

  it.effect(
    "places a rephrasing near the original and unrelated text far away",
    () =>
      Effect.gen(function* () {
        const embedder = makeOnnxLibraryEmbedder(files());
        const [query, rephrased, unrelated] = yield* Effect.forEach(
          [
            "deployment got stuck",
            "The release is stuck again",
            "Bake the sourdough in a hot oven",
          ],
          embedder.embed,
        );
        const cosine = (a: Float32Array, b: Float32Array) =>
          a.reduce((sum, value, index) => sum + value * b[index]!, 0);
        expect(query!.length).toBe(LIBRARY_EMBEDDING_MODEL.dimensions);
        expect(cosine(query!, query!)).toBeCloseTo(1, 4);
        expect(cosine(query!, rephrased!)).toBeGreaterThan(0.45);
        expect(cosine(query!, unrelated!)).toBeLessThan(0.15);
      }),
    60_000,
  );
});
