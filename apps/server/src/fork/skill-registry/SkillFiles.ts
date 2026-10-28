import { SkillRegistryError } from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Path from "effect/Path";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { validateSkill } from "./validation.ts";

export const SKILL_FILE_LIMIT = 256 * 1024;
export const SKILL_TREE_FILE_LIMIT = 2000;
export const SKILL_TREE_BYTE_LIMIT = 64 * 1024 * 1024;
export const fail = (reason: SkillRegistryError["reason"], detail: string) =>
  new SkillRegistryError({ reason, detail });
export interface SkillTreeFile {
  readonly path: string;
  readonly relativePath: string;
  readonly bytes: number;
  readonly executable: boolean;
  readonly link: string | null;
}

export const makeSkillFiles = Effect.gen(function* () {
  const runtime = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const hash = (value: string | Uint8Array) =>
    crypto
      .digest("SHA-256", typeof value === "string" ? new TextEncoder().encode(value) : value)
      .pipe(Effect.map(Hex.encode), Effect.orDie);
  const within = (root: string, file: string) => {
    const relative = path.relative(root, file);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const realOrProjected = Effect.fn("SkillFiles.realOrProjected")(function* (
    value: string,
  ): Effect.fn.Return<string, import("effect/PlatformError").PlatformError> {
    let ancestor = path.resolve(value);
    while (!(yield* fs.exists(ancestor))) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    return path.resolve(yield* fs.realPath(ancestor), path.relative(ancestor, path.resolve(value)));
  });
  const read = Effect.fn("SkillFiles.read")(function* (file: string) {
    const info = yield* fs.stat(file);
    if (info.type !== "File" || Number(info.size) > SKILL_FILE_LIMIT)
      return yield* fail("limit", "SKILL.md must be a file no larger than 256 KiB.");
    const bytes = yield* fs.readFile(file);
    const text = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: () => fail("invalid", "SKILL.md must contain UTF-8 text."),
    });
    return { text, hash: yield* hash(bytes) };
  });
  const tree = Effect.fn("SkillFiles.tree")(function* (root: string) {
    const files: SkillTreeFile[] = [];
    let bytes = 0;
    let entries = 0;
    const walk = Effect.fn("SkillFiles.walk")(function* (
      directory: string,
      depth: number,
    ): Effect.fn.Return<void, import("effect/PlatformError").PlatformError | SkillRegistryError> {
      if (depth > 16) return yield* fail("limit", "This skill exceeds the directory depth limit.");
      for (const name of (yield* fs.readDirectory(directory)).toSorted()) {
        if (++entries > 4000)
          return yield* fail("limit", "This skill exceeds the directory entry limit.");
        const file = path.join(directory, name);
        const relativePath = path.relative(root, file).split(path.sep).join("/");
        if (relativePath === ".loom-skill.json") continue;
        const link = yield* fs.readLink(file).pipe(Effect.orElseSucceed(() => null));
        if (link !== null) {
          files.push({ path: file, relativePath, bytes: link.length, executable: false, link });
          bytes += link.length;
        } else {
          const info = yield* fs.stat(file);
          if (info.type === "Directory") yield* walk(file, depth + 1);
          else if (info.type === "File") {
            bytes += Number(info.size);
            files.push({
              path: file,
              relativePath,
              bytes: Number(info.size),
              executable: (info.mode & 0o111) !== 0,
              link: null,
            });
          } else
            return yield* fail(
              "invalid",
              "Skills may contain only regular files, directories and links.",
            );
        }
        if (files.length > SKILL_TREE_FILE_LIMIT || bytes > SKILL_TREE_BYTE_LIMIT)
          return yield* fail("limit", "This skill exceeds 2,000 files or 64 MiB.");
      }
    });
    yield* walk(root, 0);
    return files;
  });
  const treeHash = Effect.fn("SkillFiles.treeHash")(function* (root: string) {
    const files = yield* tree(root);
    const digests = yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const content = file.link === null ? yield* fs.readFile(file.path) : `link:${file.link}`;
          return `${file.relativePath}\0${file.executable}\0${yield* hash(content)}`;
        }),
      { concurrency: 4 },
    );
    return yield* hash(digests.join("\n"));
  });
  const readSkill = Effect.fn("SkillFiles.readSkill")(function* (directory: string) {
    const file = path.join(directory, "SKILL.md");
    const contents = yield* read(file);
    return {
      key: directory,
      path: file,
      ...contents,
      validation: validateSkill(contents.text, path.basename(directory)),
    };
  });
  const writeSkill = Effect.fn("SkillFiles.writeSkill")(function* (
    directory: string,
    expectedHash: string,
    text: string,
  ) {
    const validation = validateSkill(text, path.basename(directory));
    if (validation.issues.some((issue) => issue.severity === "error"))
      return yield* fail("invalid", "Fix the validation errors before saving.");
    const file = path.join(directory, "SKILL.md");
    if ((yield* fs.realPath(file)) !== file)
      return yield* fail(
        "read-only",
        "The skill file is linked to another location. Edit it at its source.",
      );
    const current = yield* read(file);
    if (current.hash !== expectedHash)
      return yield* fail("conflict", "SKILL.md changed on disk. Reload it before saving.");
    yield* writeFileStringAtomically({ filePath: file, contents: text }).pipe(
      Effect.provideContext(runtime),
    );
    return yield* readSkill(directory);
  });
  return { fs, path, hash, within, realOrProjected, read, tree, treeHash, readSkill, writeSkill };
});
