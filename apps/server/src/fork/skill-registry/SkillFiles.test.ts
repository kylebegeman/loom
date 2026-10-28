import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makeSkillFiles } from "./SkillFiles.ts";

const layer = Layer.merge(NodeServices.layer, NodeCrypto.layer);
it.effect("detects an external Lab edit and preserves the newer content", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* makeSkillFiles;
      const root = yield* files.fs
        .makeTempDirectoryScoped()
        .pipe(Effect.flatMap((directory) => files.fs.realPath(directory)));
      const file = files.path.join(root, "SKILL.md");
      const original =
        "---\nname: sample\ndescription: Test a behavior\n---\nOriginal instructions\n";
      yield* files.fs.writeFileString(file, original);
      const first = yield* files.readSkill(root);
      yield* files.fs.writeFileString(file, original.replace("Original", "Newer"));
      const error = yield* Effect.flip(
        files.writeSkill(root, first.hash, original.replace("Original", "Stale")),
      );
      expect(error).toMatchObject({ reason: "conflict" });
      expect(yield* files.fs.readFileString(file)).toContain("Newer instructions");
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect(
  "hashes scripts, executable modes and binary assets without following external links",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const files = yield* makeSkillFiles;
        const root = yield* files.fs.makeTempDirectoryScoped();
        const outside = yield* files.fs.makeTempDirectoryScoped();
        const binary = files.path.join(root, "asset.bin");
        yield* files.fs.writeFile(binary, new Uint8Array([0, 255, 3, 128]));
        yield* files.fs.symlink(outside, files.path.join(root, "external"));
        const before = yield* files.treeHash(root);
        yield* files.fs.writeFileString(files.path.join(outside, "private.txt"), "Do not read");
        expect(yield* files.treeHash(root)).toBe(before);
        yield* files.fs.writeFile(binary, new Uint8Array([0, 254, 3, 128]));
        expect(yield* files.treeHash(root)).not.toBe(before);
        expect((yield* files.tree(root)).map((file) => file.relativePath)).toEqual([
          "asset.bin",
          "external",
        ]);
      }),
    ).pipe(Effect.provide(layer)),
);

it.effect("refuses a linked SKILL.md instead of editing another file", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = yield* makeSkillFiles;
      const root = yield* files.fs.makeTempDirectoryScoped();
      const outside = files.path.join(root, "original.md");
      yield* files.fs.writeFileString(outside, "---\nname: x\ndescription: Explain\n---\nBody");
      yield* files.fs.symlink(outside, files.path.join(root, "SKILL.md"));
      const first = yield* files.readSkill(root);
      expect(yield* Effect.flip(files.writeSkill(root, first.hash, first.text))).toMatchObject({
        reason: "read-only",
      });
    }),
  ).pipe(Effect.provide(layer)),
);
