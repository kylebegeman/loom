// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as DateTime from "effect/DateTime";
import { ModelPreviewError, type ModelFileRef } from "@t3tools/contracts/fork";
import { resolveSymlinkTarget } from "@t3tools/shared/symlink";
import { isContained } from "../signedFiles.ts";
import { UndoManifest, HISTORY_UNDO_MAX, HISTORY_UNDO_TTL_MS, safeRepoPath } from "./helpers.ts";
import type { HistoryGit } from "./git.ts";

const fail = (reason: ModelPreviewError["reason"], message: string) =>
  new ModelPreviewError({ reason, message });
const decode = Schema.decodeEffect(Schema.fromJsonString(UndoManifest));
const encode = Schema.encodeSync(Schema.fromJsonString(UndoManifest));
export const makeHistoryRestore = (options: {
  readonly undoDir: string;
  readonly git: HistoryGit;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lock = yield* Semaphore.make(1);
    yield* fs.makeDirectory(options.undoDir, { recursive: true });
    const destination = Effect.fn("ModelHistory.restoreDestination")(function* (
      root: string,
      relative: string,
    ) {
      if (!safeRepoPath(relative))
        return yield* fail("invalid-path", "Choose files inside the workspace.");
      const lexical = path.resolve(root, relative);
      const target = yield* resolveSymlinkTarget(lexical).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
      );
      if (!isContained(root, target))
        return yield* fail("invalid-path", "The file points outside the workspace.");
      // Check the nearest existing parent before creating directories through any symlink.
      let parent = path.dirname(target);
      while (!(yield* fs.exists(parent))) {
        const next = path.dirname(parent);
        if (next === parent)
          return yield* fail("invalid-path", "Choose files inside the workspace.");
        parent = next;
      }
      const realParent = yield* fs.realPath(parent);
      if (!isContained(root, realParent))
        return yield* fail("invalid-path", "The file points outside the workspace.");
      const existing = yield* fs.exists(target);
      if (existing && (yield* fs.stat(target)).type !== "File")
        return yield* fail("invalid-path", "Choose model files, rather than directories.");
      return path.resolve(realParent, path.relative(parent, target));
    });
    const write = Effect.fn("ModelHistory.atomicCopy")(function* (
      source: string,
      target: string,
      mode: number,
    ) {
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      const temporary = path.join(
        path.dirname(target),
        `.${path.basename(target)}.loom-restore-${NodeCrypto.randomUUID()}`,
      );
      yield* Effect.gen(function* () {
        yield* fs.copyFile(source, temporary);
        yield* fs.chmod(temporary, mode & 0o777);
        yield* fs.rename(temporary, target);
      }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
    });
    const prune = Effect.fn("ModelHistory.pruneUndo")(function* () {
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      const names = yield* fs.readDirectory(options.undoDir);
      const records = yield* Effect.forEach(names, (name) =>
        Effect.gen(function* () {
          if (!/^[0-9a-f-]{36}$/.test(name)) return null;
          const dir = path.join(options.undoDir, name);
          const manifest = yield* fs.readFileString(path.join(dir, "manifest.json")).pipe(
            Effect.flatMap(decode),
            Effect.orElseSucceed(() => null),
          );
          return manifest ? { dir, at: manifest.createdAt } : null;
        }),
      );
      const sorted = records.filter((record) => record !== null).toSorted((a, b) => b.at - a.at);
      yield* Effect.forEach(
        sorted,
        (record, i) =>
          i >= HISTORY_UNDO_MAX || now - record.at > HISTORY_UNDO_TTL_MS
            ? fs.remove(record.dir, { recursive: true, force: true })
            : Effect.void,
        { discard: true },
      );
    });
    const restore = (input: {
      root: string;
      file: ModelFileRef;
      entries: ReadonlyArray<{ path: string; source: string; mode: number }>;
    }) =>
      lock.withPermit(
        Effect.uninterruptible(
          Effect.gen(function* () {
            const targets = yield* Effect.forEach(input.entries, (entry) =>
              destination(input.root, entry.path).pipe(
                Effect.map((target) => ({ ...entry, target })),
              ),
            );
            const id: string = NodeCrypto.randomUUID();
            const dir = path.join(options.undoDir, id);
            yield* fs.makeDirectory(path.join(dir, "files"), { recursive: true });
            const backups = yield* Effect.forEach(targets, (entry, index) =>
              Effect.gen(function* () {
                const present = yield* fs.exists(entry.target);
                const backup = present ? String(index) : null;
                const mode = present ? (yield* fs.stat(entry.target)).mode : 0;
                if (backup !== null)
                  yield* fs.copyFile(entry.target, path.join(dir, "files", backup));
                return {
                  path: entry.path,
                  backup,
                  mode,
                  restoredOid: null,
                  target: entry.target,
                  restoredMode: entry.mode & 0o777,
                };
              }),
            );
            const manifest: UndoManifest = {
              id,
              root: input.root,
              threadId: input.file.threadId,
              modelPath: input.file.path,
              createdAt: DateTime.toEpochMillis(yield* DateTime.now),
              entries: backups,
            };
            yield* fs.writeFileString(path.join(dir, "manifest.json"), encode(manifest));
            yield* Effect.gen(function* () {
              for (const target of targets) yield* write(target.source, target.target, target.mode);
              const prefix = (yield* options.git.repoPrefix(input.root)) ?? "";
              const hashes = yield* options.git.hashObjects(
                input.root,
                targets.map((target) => target.path),
              );
              const complete: UndoManifest = {
                ...manifest,
                entries: manifest.entries.map((entry) => ({
                  ...entry,
                  restoredOid: hashes.get(prefix + entry.path) ?? null,
                })),
              };
              yield* fs.writeFileString(path.join(dir, "manifest.json"), encode(complete));
            }).pipe(
              Effect.catch((cause) =>
                Effect.gen(function* () {
                  // A failed multi-file restore puts every preflighted destination back before reporting failure.
                  for (let index = targets.length - 1; index >= 0; index--) {
                    const previous = backups[index]!;
                    const target = targets[index]!.target;
                    if (previous.backup === null) yield* fs.remove(target, { force: true });
                    else
                      yield* write(path.join(dir, "files", previous.backup), target, previous.mode);
                  }
                  yield* fs.remove(dir, { recursive: true, force: true });
                  return yield* Effect.fail(cause);
                }),
              ),
            );
            yield* prune();
            return { undoId: id, restored: targets.map((target) => target.path) };
          }),
        ),
      );
    const undo = (input: { root: string; file: ModelFileRef; undoId: string }) =>
      lock.withPermit(
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (!/^[0-9a-f-]{36}$/.test(input.undoId))
              return yield* fail("not-found", "This restore can no longer be undone.");
            const dir = path.join(options.undoDir, input.undoId);
            const manifest = yield* fs.readFileString(path.join(dir, "manifest.json")).pipe(
              Effect.flatMap(decode),
              Effect.mapError(() => fail("not-found", "This restore can no longer be undone.")),
            );
            if (
              manifest.id !== input.undoId ||
              manifest.root !== input.root ||
              manifest.threadId !== input.file.threadId ||
              manifest.modelPath !== input.file.path ||
              DateTime.toEpochMillis(yield* DateTime.now) - manifest.createdAt > HISTORY_UNDO_TTL_MS
            )
              return yield* fail("not-found", "This restore can no longer be undone.");
            const targets = yield* Effect.forEach(manifest.entries, (entry) =>
              destination(input.root, entry.path),
            );
            if (targets.some((target, index) => target !== manifest.entries[index]!.target))
              return yield* fail(
                "conflict",
                "The model path changed after the restore, so Undo would overwrite newer work.",
              );
            const modes = yield* Effect.forEach(targets, (target) =>
              fs.stat(target).pipe(
                Effect.map((info) => info.mode & 0o777),
                Effect.orElseSucceed(() => null),
              ),
            );
            if (modes.some((mode, index) => mode !== manifest.entries[index]!.restoredMode))
              return yield* fail(
                "conflict",
                "The model changed after the restore, so Undo would overwrite newer work.",
              );
            const prefix = (yield* options.git.repoPrefix(input.root)) ?? "";
            const hashes = yield* options.git.hashObjects(
              input.root,
              manifest.entries.map((entry) => entry.path),
            );
            if (
              manifest.entries.some(
                (entry) => (hashes.get(prefix + entry.path) ?? null) !== entry.restoredOid,
              )
            )
              return yield* fail(
                "conflict",
                "The model changed after the restore, so Undo would overwrite newer work.",
              );
            // Validate every backup before making the first write.
            for (const entry of manifest.entries)
              if (
                entry.backup !== null &&
                (!/^\d+$/.test(entry.backup) ||
                  !(yield* fs.exists(path.join(dir, "files", entry.backup))))
              )
                return yield* fail("not-found", "This restore can no longer be undone.");
            for (let index = 0; index < manifest.entries.length; index++) {
              const entry = manifest.entries[index]!;
              if (entry.backup === null) yield* fs.remove(targets[index]!, { force: true });
              else yield* write(path.join(dir, "files", entry.backup), targets[index]!, entry.mode);
            }
            yield* fs.remove(dir, { recursive: true, force: true });
          }),
        ),
      );
    yield* prune();
    return { restore, undo, prune };
  });
