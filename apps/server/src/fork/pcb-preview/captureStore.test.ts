import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { makeCaptureStore } from "./captureStore.ts";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOJ0AAAAASUVORK5CYII=";
// Keep seeded files newer than the new capture to exercise protected retention.
const futureModified = 2_840_140_800;
const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "loom-capture-store-" });
  const directory = path.join(root, "captures");
  const store = yield* makeCaptureStore(directory);
  return { fs, path, directory, ...store };
});
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect(
  "saves existing PNG captures and optional XML SVG roots without requiring callers' host services",
  () =>
    run(
      Effect.gen(function* () {
        const { fs, saveCapture, directory } = yield* setup;
        expect(yield* saveCapture({})).toBeUndefined();
        expect(yield* fs.exists(directory)).toBe(false);
        const image = yield* saveCapture({ png });
        expect(image).toMatch(/\/[a-f0-9-]{36}\.png$/);
        expect(Buffer.from(yield* fs.readFile(image!))).toEqual(Buffer.from(png, "base64"));
        const svg =
          '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0"/></svg>';
        const drawing = yield* saveCapture({ svg });
        expect(drawing).toMatch(/\/[a-f0-9-]{36}\.svg$/);
        expect(yield* fs.readFileString(drawing!)).toBe(svg);
      }),
    ),
);

it.effect("rejects both supplied formats, including empty values, before creating files", () =>
  run(
    Effect.gen(function* () {
      const { fs, directory, saveCapture } = yield* setup;
      for (const input of [
        { png, svg: "<svg/>" },
        { png: "", svg: "" },
        { png, svg: "" },
      ]) {
        const error = yield* Effect.flip(saveCapture(input));
        expect(error).toMatchObject({ _tag: "PcbPreviewError", reason: "invalid-report" });
      }
      expect(yield* fs.exists(directory)).toBe(false);
    }),
  ),
);

it.effect("requires a PNG signature and bounds decoded bytes to 8 MiB", () =>
  run(
    Effect.gen(function* () {
      const { saveCapture } = yield* setup;
      for (const invalid of ["", Buffer.from("not a PNG").toString("base64")])
        expect(yield* Effect.flip(saveCapture({ png: invalid }))).toMatchObject({
          reason: "invalid-report",
        });
      const oversized = Buffer.alloc(8 * 1024 * 1024 + 1);
      Buffer.from(png, "base64").subarray(0, 8).copy(oversized);
      expect(yield* Effect.flip(saveCapture({ png: oversized.toString("base64") }))).toMatchObject({
        reason: "invalid-report",
      });
    }),
  ),
);

it.effect("requires an SVG root and bounds UTF-8 bytes rather than JavaScript string length", () =>
  run(
    Effect.gen(function* () {
      const { saveCapture } = yield* setup;
      for (const svg of [
        "",
        "<html><svg/></html>",
        "<svgish/>",
        "<svg/><!--after-->",
        '<?xml version="1.0"?><html/>',
      ])
        expect(yield* Effect.flip(saveCapture({ svg }))).toMatchObject({
          reason: "invalid-report",
        });
      const oversized = `<svg>${"é".repeat(4 * 1024 * 1024)}</svg>`;
      expect(oversized.length).toBeLessThan(8 * 1024 * 1024);
      expect(yield* Effect.flip(saveCapture({ svg: oversized }))).toMatchObject({
        reason: "invalid-report",
      });
    }),
  ),
);

it.effect("prunes PNG and SVG together to 50 files and preserves the newly written capture", () =>
  run(
    Effect.gen(function* () {
      const { fs, path, directory, saveCapture } = yield* setup;
      yield* fs.makeDirectory(directory);
      for (let index = 0; index < 55; index++) {
        const name = `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}.${index % 2 ? "svg" : "png"}`;
        const file = path.join(directory, name);
        yield* fs.writeFileString(file, "old");
        yield* fs.utimes(file, futureModified, futureModified);
      }
      yield* fs.writeFileString(path.join(directory, "notes.png"), "unrelated");
      const saved = yield* saveCapture({ svg: "<svg/>" });
      const names = yield* fs.readDirectory(directory);
      expect(names.filter((name) => name !== "notes.png")).toHaveLength(50);
      expect(yield* fs.exists(saved!)).toBe(true);
      expect(yield* fs.readFileString(path.join(directory, "notes.png"))).toBe("unrelated");
      expect(names.some((name) => name.endsWith(".png"))).toBe(true);
      expect(names.some((name) => name.endsWith(".svg"))).toBe(true);
    }),
  ),
);

it.effect("prunes the combined byte budget and serializes concurrent saves", () =>
  run(
    Effect.gen(function* () {
      const { fs, path, directory, saveCapture } = yield* setup;
      yield* fs.makeDirectory(directory);
      for (let index = 0; index < 8; index++) {
        const file = path.join(
          directory,
          `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}.${index % 2 ? "svg" : "png"}`,
        );
        yield* fs.writeFileString(file, "");
        yield* fs.truncate(file, 7 * 1024 * 1024);
      }
      yield* saveCapture({ png });
      const afterPrune = yield* fs.readDirectory(directory);
      const prunedStats = yield* Effect.forEach(afterPrune, (name) =>
        fs.stat(path.join(directory, name)),
      );
      expect(prunedStats.reduce((sum, info) => sum + Number(info.size), 0)).toBeLessThanOrEqual(
        50 * 1024 * 1024,
      );
      yield* Effect.forEach(
        Array.from({ length: 51 }, (_, index) => index),
        (index) => saveCapture(index % 2 ? { svg: "<svg/>" } : { png }),
        { concurrency: "unbounded" },
      );
      const names = yield* fs.readDirectory(directory);
      const infos = yield* Effect.forEach(names, (name) => fs.stat(path.join(directory, name)));
      expect(names).toHaveLength(50);
      expect(infos.reduce((sum, info) => sum + Number(info.size), 0)).toBeLessThanOrEqual(
        50 * 1024 * 1024,
      );
      const recent = yield* saveCapture({ svg: "<svg/>" });
      expect(yield* fs.exists(recent!)).toBe(true);
    }),
  ),
);
