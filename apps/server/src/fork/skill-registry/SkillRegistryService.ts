import { validateSkill } from "./validation.ts";
import type { SkillValidation } from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import {
  SkillRegistryError,
  SkillRegistryInstall,
  type SkillRegistryInventory,
  type SkillFetchInput,
  type SkillFetchJob,
  type SkillInstallInput,
  type SkillRegistrySource,
  type SkillFileInput,
  type SkillFile,
  type SkillWriteInput,
  type SkillScaffoldInput,
  type SkillSetEnabledInput,
  type SkillUpdatePreview,
  type SkillUpdateInput,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import { createTwoFilesPatch } from "diff";
import { stringify as stringifyYaml } from "yaml";
import { makeSkillCatalog } from "./SkillCatalog.ts";
import { makeSkillSources } from "./SkillSources.ts";
import { SkillStore } from "./SkillStore.ts";
import { fail } from "./SkillFiles.ts";
import { makeProviderControls } from "./ProviderControls.ts";

const suggested = [
  { name: "impeccable", url: "https://github.com/pbakaus/impeccable", license: "Apache-2.0" },
  { name: "ponytail", url: "https://github.com/DietrichGebert/ponytail", license: "MIT" },
] as const;
const isSkillError = Schema.is(SkillRegistryError);
const encodeMarker = Schema.encodeEffect(Schema.fromJsonString(SkillRegistryInstall));
const decodeMarker = Schema.decodeUnknownEffect(Schema.fromJsonString(SkillRegistryInstall));
type InventoryInput = {
  readonly projectId: ProjectId | null;
  readonly refresh?: boolean | undefined;
};

export class SkillRegistryService extends Context.Service<
  SkillRegistryService,
  {
    readonly validate: (input: {
      readonly text: string;
      readonly folderName: string;
    }) => Effect.Effect<SkillValidation>;
    readonly inventory: (
      input: InventoryInput,
    ) => Effect.Effect<SkillRegistryInventory, SkillRegistryError>;
    readonly sources: Effect.Effect<
      {
        readonly sources: readonly SkillRegistrySource[];
        readonly installs: readonly SkillRegistryInstall[];
        readonly suggested: typeof suggested;
      },
      SkillRegistryError
    >;
    readonly fetchSource: (
      input: SkillFetchInput,
    ) => Effect.Effect<SkillFetchJob, SkillRegistryError>;
    readonly watchFetch: (requestId: string) => Stream.Stream<SkillFetchJob, SkillRegistryError>;
    readonly cancelFetch: (requestId: string) => Effect.Effect<void, SkillRegistryError>;
    readonly install: (
      input: SkillInstallInput,
    ) => Effect.Effect<readonly SkillRegistryInstall[], SkillRegistryError>;
    readonly previewUpdate: (input: {
      readonly projectId: ProjectId | null;
      readonly installId: string;
    }) => Effect.Effect<SkillUpdatePreview, SkillRegistryError>;
    readonly update: (
      input: SkillUpdateInput,
    ) => Effect.Effect<SkillRegistryInstall, SkillRegistryError>;
    readonly remove: (
      input: SkillFileInput & { readonly expectedHash: string },
    ) => Effect.Effect<{ readonly trashPath: string }, SkillRegistryError>;
    readonly readSkill: (input: SkillFileInput) => Effect.Effect<SkillFile, SkillRegistryError>;
    readonly writeSkill: (input: SkillWriteInput) => Effect.Effect<SkillFile, SkillRegistryError>;
    readonly scaffold: (input: SkillScaffoldInput) => Effect.Effect<SkillFile, SkillRegistryError>;
    readonly setEnabled: (
      input: SkillSetEnabledInput,
    ) => Effect.Effect<SkillRegistryInventory, SkillRegistryError>;
  }
>()("t3/fork/skill-registry/SkillRegistryService") {}

const make = Effect.gen(function* () {
  const catalog = yield* makeSkillCatalog;
  const sourceFiles = yield* makeSkillSources;
  const controls = yield* makeProviderControls;
  const store = yield* SkillStore;
  const crypto = yield* Crypto.Crypto;
  const files = catalog.files;
  const { fs, path } = files;
  const mutex = yield* Semaphore.make(1);
  const cache = new Map<
    ProjectId | null,
    { readonly at: number; readonly value: SkillRegistryInventory }
  >();
  const reviews = new Map<
    string,
    {
      readonly install: SkillRegistryInstall;
      readonly source: SkillRegistrySource;
      readonly currentHash: string;
    }
  >();
  const activeInstalls = Effect.map(store.read, (state) =>
    state.installs.filter((install) => install.removedAt === null),
  );
  const io = (cause: unknown) =>
    isSkillError(cause)
      ? cause
      : fail(
          "io",
          "The skill operation failed. Existing files and recovery copies were preserved.",
        );
  const guarded = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
    operation.pipe(Effect.mapError(io));
  const uuid = crypto.randomUUIDv4().pipe(Effect.orDie);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const inventory = Effect.fn("SkillRegistry.inventory")(function* (input: InventoryInput) {
    const currentTime = DateTime.toEpochMillis(yield* DateTime.now);
    const cached = cache.get(input.projectId);
    if (!input.refresh && cached !== undefined && currentTime - cached.at < 60000)
      return cached.value;
    const value = yield* catalog.inventory(input.projectId, yield* activeInstalls);
    cache.set(input.projectId, { at: currentTime, value });
    return value;
  }, Effect.mapError(io));
  const refreshCatalog = Effect.fn("SkillRegistry.refreshCatalog")((projectId: ProjectId | null) =>
    catalog
      .refresh(projectId)
      .pipe(Effect.timeout("20 seconds"), Effect.ignoreCause({ log: true })),
  );
  const changed = Effect.fn("SkillRegistry.changed")(function* (projectId: ProjectId | null) {
    cache.clear();
    yield* refreshCatalog(projectId);
  });
  const entryFor = Effect.fn("SkillRegistry.entryFor")(function* (input: SkillFileInput) {
    const entry = (yield* inventory({ projectId: input.projectId, refresh: true })).entries.find(
      (value) => value.key === input.key,
    );
    if (entry === undefined)
      return yield* fail(
        "not-found",
        "This skill is no longer in the current inventory. Refresh the list.",
      );
    return entry;
  });
  const editable = Effect.fn("SkillRegistry.editable")(function* (input: SkillFileInput) {
    const entry = yield* entryFor(input);
    if (!entry.editable || entry.locations.length === 0)
      return yield* fail(
        "read-only",
        "Plugin, system and unrecognized skill folders are read-only here.",
      );
    if ((yield* fs.realPath(entry.key)) !== entry.key)
      return yield* fail("conflict", "This skill's location changed. Refresh before editing.");
    return entry;
  });
  const targetFor = Effect.fn("SkillRegistry.targetFor")(function* (
    projectId: ProjectId | null,
    targetId: string,
  ) {
    const target = (yield* catalog.context(projectId)).targets.find(
      (value) => value.id === targetId,
    );
    if (target === undefined)
      return yield* fail("invalid", "Choose a current install target on this environment.");
    yield* fs.makeDirectory(target.path, { recursive: true });
    if ((yield* fs.realPath(target.path)) !== target.realPath)
      return yield* fail("conflict", "The target folder moved. Refresh before installing.");
    return target;
  });
  const managed = Effect.fn("SkillRegistry.managed")(function* (
    installId: string,
    projectId: ProjectId | null,
  ) {
    const install = (yield* activeInstalls).find((value) => value.id === installId);
    if (install === undefined)
      return yield* fail("read-only", "Loom did not install this skill. Manage it at its source.");
    const entry = yield* editable({ projectId, key: install.directory });
    const marker = yield* fs
      .readFileString(path.join(entry.key, ".loom-skill.json"))
      .pipe(Effect.flatMap(decodeMarker));
    if (marker.id !== install.id || marker.directory !== install.directory)
      return yield* fail(
        "conflict",
        "The skill's provenance changed. Existing files were preserved.",
      );
    return install;
  });
  const moveToTrash = Effect.fn("SkillRegistry.moveToTrash")(function* (
    directory: string,
    expectedHash: string,
  ) {
    if ((yield* files.treeHash(directory)) !== expectedHash)
      return yield* fail(
        "conflict",
        "The skill changed on disk. Review it again before moving it to trash.",
      );
    const trashRoot = path.join(store.root, "trash");
    yield* fs.makeDirectory(trashRoot, { recursive: true });
    const destination = path.join(trashRoot, `${yield* uuid}-${path.basename(directory)}`);
    const moved = yield* fs.rename(directory, destination).pipe(Effect.result);
    if (moved._tag === "Failure") {
      // A target may be on another volume; verify the full recovery copy before unlinking it.
      yield* fs.copy(directory, destination, { overwrite: false });
      if (
        (yield* files.treeHash(destination)) !== expectedHash ||
        (yield* files.treeHash(directory)) !== expectedHash
      )
        return yield* fail(
          "conflict",
          `The skill changed while copying to trash. Its original remains in place; a recovery copy is at ${destination}.`,
        );
      yield* fs.remove(directory, { recursive: true });
    }
    return destination;
  });
  const mark = Effect.fn("SkillRegistry.mark")(function* (
    directory: string,
    install: SkillRegistryInstall,
  ) {
    yield* fs.writeFileString(
      path.join(directory, ".loom-skill.json"),
      yield* encodeMarker(install),
    );
  });
  const withStaging = Effect.fn("SkillRegistry.withStaging")(
    <A, E, R>(
      parent: string,
      run: (stage: string, preserve: () => void) => Effect.Effect<A, E, R>,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          let keep = false;
          const stage = yield* Effect.acquireRelease(
            fs.makeTempDirectory({ directory: parent, prefix: ".loom-skill-" }),
            (directory) =>
              keep
                ? Effect.void
                : fs.remove(directory, { recursive: true }).pipe(Effect.ignore({ log: true })),
          );
          return yield* run(stage, () => {
            keep = true;
          });
        }),
      ),
  );
  const stageSkill = Effect.fn("SkillRegistry.stageSkill")(function* (
    source: SkillRegistrySource,
    subpath: string,
    directory: string,
  ) {
    yield* sourceFiles.copySkill(source, subpath, directory);
    if (source.license === null || (yield* fs.exists(path.join(directory, "LICENSE")))) return;
    let filename = "LICENSE.source";
    let suffix = 0;
    while (yield* fs.exists(path.join(directory, filename)))
      filename = `LICENSE.source.${++suffix}`;
    yield* fs.writeFileString(path.join(directory, filename), source.license);
  });
  const install = Effect.fn("SkillRegistry.install")(function* (input: SkillInstallInput) {
    const source = (yield* store.read).sources.find(
      (value) => value.id === input.sourceId && value.commit === input.commit,
    );
    if (source === undefined)
      return yield* fail(
        "conflict",
        "This source revision changed. Fetch it again and review the selected skills.",
      );
    const target = yield* targetFor(input.projectId, input.targetId);
    const chosen = input.subpaths.map((subpath) =>
      source.skills.find((skill) => skill.subpath === subpath),
    );
    if (
      chosen.some(
        (skill) => skill === undefined || skill.issues.some((issue) => issue.severity === "error"),
      )
    )
      return yield* fail("invalid", "Choose valid skills from the fetched source.");
    const names = chosen.map((skill) =>
      skill!.subpath === "." ? skill!.name : path.basename(skill!.subpath),
    );
    if (
      new Set(names).size !== names.length ||
      names.some((name) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))
    )
      return yield* fail(
        "invalid",
        "Choose one source variant per skill and use valid skill folder names.",
      );
    const installed = yield* withStaging(target.realPath, (stage, preserve) =>
      Effect.gen(function* () {
        const prepared: SkillRegistryInstall[] = [];
        for (let index = 0; index < chosen.length; index++) {
          const name = names[index]!;
          const destination = path.join(target.realPath, name);
          if (
            (yield* fs.exists(destination)) ||
            (yield* fs.readLink(destination).pipe(Effect.orElseSucceed(() => null))) !== null
          )
            return yield* fail(
              "conflict",
              `${name} already exists. Review its source update instead of replacing it.`,
            );
          const next = path.join(stage, name);
          yield* stageSkill(source, chosen[index]!.subpath, next);
          const record: SkillRegistryInstall = {
            id: yield* uuid,
            directory: destination,
            name,
            sourceId: source.id,
            sourceUrl: source.url,
            commit: source.commit,
            subpath: chosen[index]!.subpath,
            installedAt: yield* now,
            hash: yield* files.treeHash(next),
          };
          yield* mark(next, record);
          prepared.push(record);
        }
        const placed: SkillRegistryInstall[] = [];
        const commit = Effect.uninterruptible(
          Effect.gen(function* () {
            for (const record of prepared) {
              if (yield* fs.exists(record.directory))
                return yield* fail(
                  "conflict",
                  `${record.name} appeared while staging. Existing files were preserved.`,
                );
              yield* fs.rename(path.join(stage, record.name), record.directory);
              placed.push(record);
            }
            yield* store.update((state) => ({
              ...state,
              installs: [
                ...state.installs,
                ...prepared.map((record) => ({ ...record, removedAt: null })),
              ],
            }));
            return prepared;
          }),
        );
        return yield* commit.pipe(
          Effect.tapError(() =>
            Effect.forEach(
              placed.toReversed(),
              (record) =>
                Effect.gen(function* () {
                  if ((yield* files.treeHash(record.directory)) !== record.hash) {
                    preserve();
                    return;
                  }
                  yield* fs.rename(record.directory, path.join(stage, record.name));
                }),
              { discard: true },
            ).pipe(
              Effect.tapError(() => Effect.sync(preserve)),
              Effect.ignore({ log: true }),
            ),
          ),
        );
      }),
    );
    yield* changed(input.projectId);
    return installed;
  });
  const readSkill = Effect.fn("SkillRegistry.readSkill")(function* (input: SkillFileInput) {
    const entry = yield* editable(input);
    return yield* files.readSkill(entry.key);
  });
  const writeSkill = Effect.fn("SkillRegistry.writeSkill")(function* (input: SkillWriteInput) {
    const entry = yield* editable(input);
    const result = yield* files.writeSkill(entry.key, input.expectedHash, input.text);
    yield* changed(input.projectId);
    return result;
  });
  const scaffold = Effect.fn("SkillRegistry.scaffold")(function* (input: SkillScaffoldInput) {
    const target = yield* targetFor(input.projectId, input.targetId);
    const destination = path.join(target.realPath, input.name);
    if (yield* fs.exists(destination))
      return yield* fail("conflict", "A skill with that folder name already exists.");
    yield* withStaging(target.realPath, (stage, preserve) =>
      Effect.gen(function* () {
        const next = path.join(stage, input.name);
        yield* fs.makeDirectory(next);
        const metadata = {
          name: input.name,
          description: input.description,
          ...(input.userInvocationOnly ? { "disable-model-invocation": true } : {}),
          ...(input.hideFromSlashMenu ? { "user-invocable": false } : {}),
        };
        yield* fs.writeFileString(
          path.join(next, "SKILL.md"),
          `---\n${stringifyYaml(metadata)}---\n\n${input.body.trim()}\n`,
        );
        const skill = yield* files.readSkill(next);
        if (skill.validation.issues.some((issue) => issue.severity === "error"))
          return yield* fail(
            "invalid",
            "Fix the skill's name, description and instructions before creating it.",
          );
        if (input.userInvocationOnly) {
          yield* fs.makeDirectory(path.join(next, "agents"));
          yield* fs.writeFileString(
            path.join(next, "agents", "openai.yaml"),
            "policy:\n  allow_implicit_invocation: false\n",
          );
        }
        const record: SkillRegistryInstall = {
          id: yield* uuid,
          directory: destination,
          name: input.name,
          sourceId: null,
          sourceUrl: "lab",
          commit: null,
          subpath: input.name,
          installedAt: yield* now,
          hash: yield* files.treeHash(next),
        };
        yield* mark(next, record);
        if (yield* fs.exists(destination))
          return yield* fail("conflict", "The destination appeared while preparing this skill.");
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* fs.rename(next, destination);
            yield* store
              .update((state) => ({
                ...state,
                installs: [...state.installs, { ...record, removedAt: null }],
              }))
              .pipe(
                Effect.tapError(() =>
                  Effect.gen(function* () {
                    if ((yield* files.treeHash(destination)) !== record.hash) {
                      preserve();
                      return;
                    }
                    yield* fs.rename(destination, next);
                  }).pipe(
                    Effect.tapError(() => Effect.sync(preserve)),
                    Effect.ignore({ log: true }),
                  ),
                ),
              );
          }),
        );
      }),
    );
    yield* changed(input.projectId);
    return yield* files.readSkill(destination);
  });
  const remove = Effect.fn("SkillRegistry.remove")(function* (
    input: SkillFileInput & { readonly expectedHash: string },
  ) {
    const entry = yield* entryFor(input);
    if (entry.install === null)
      return yield* fail("read-only", "Loom did not install this skill. Manage it at its source.");
    const record = yield* managed(entry.install.id, input.projectId);
    const trashPath = yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const trashPath = yield* moveToTrash(record.directory, input.expectedHash);
        const removedAt = yield* now;
        yield* store
          .update((state) => ({
            ...state,
            installs: state.installs.map((value) =>
              value.id === record.id ? { ...value, removedAt } : value,
            ),
          }))
          .pipe(
            Effect.tapError(() =>
              Effect.gen(function* () {
                if (yield* fs.exists(record.directory))
                  return yield* fail(
                    "conflict",
                    `The original folder reappeared. Its recovery copy remains at ${trashPath}.`,
                  );
                yield* fs.copy(trashPath, record.directory, { overwrite: false });
              }),
            ),
          );
        return trashPath;
      }),
    );
    yield* changed(input.projectId);
    return { trashPath };
  });
  const previewUpdate = Effect.fn("SkillRegistry.previewUpdate")(function* (input: {
    readonly projectId: ProjectId | null;
    readonly installId: string;
  }) {
    const record = yield* managed(input.installId, input.projectId);
    const source = (yield* store.read).sources.find((value) => value.id === record.sourceId);
    if (source === undefined)
      return yield* fail("invalid", "Fetch this skill's git source before reviewing its update.");
    const currentHash = yield* files.treeHash(record.directory);
    const preview = yield* withStaging(path.dirname(record.directory), (stage) =>
      Effect.gen(function* () {
        const next = path.join(stage, "next");
        yield* stageSkill(source, record.subpath, next);
        const before = new Map(
          (yield* files.tree(record.directory)).map((file) => [file.relativePath, file]),
        );
        const after = new Map((yield* files.tree(next)).map((file) => [file.relativePath, file]));
        const changes: Array<{ path: string; change: "added" | "modified" | "removed" }> = [];
        let diff = "";
        let truncated = false;
        for (const name of [...new Set([...before.keys(), ...after.keys()])].toSorted()) {
          const old = before.get(name);
          const fresh = after.get(name);
          const oldBytes =
            old === undefined
              ? new Uint8Array()
              : old.link === null
                ? yield* fs.readFile(old.path)
                : new TextEncoder().encode(`link:${old.link}`);
          const newBytes = fresh === undefined ? new Uint8Array() : yield* fs.readFile(fresh.path);
          if (
            old !== undefined &&
            fresh !== undefined &&
            (yield* files.hash(oldBytes)) === (yield* files.hash(newBytes)) &&
            old.executable === fresh.executable
          )
            continue;
          changes.push({
            path: name,
            change: old === undefined ? "added" : fresh === undefined ? "removed" : "modified",
          });
          if (diff.length >= 131072 || oldBytes.length + newBytes.length > 262144) {
            truncated = true;
            continue;
          }
          const decode = (bytes: Uint8Array) =>
            new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          diff += yield* Effect.try({
            try: () =>
              createTwoFilesPatch(
                name,
                name,
                decode(oldBytes),
                decode(newBytes),
                record.commit ?? "installed",
                source.commit,
              ),
            catch: () => `${name}: binary file changed\n`,
          }).pipe(Effect.orElseSucceed((message) => message));
        }
        if (diff.length > 131072) {
          diff = diff.slice(0, 131072);
          truncated = true;
        }
        return { files: changes, diff, truncated };
      }),
    );
    const reviewToken = yield* files.hash(`${record.id}\0${currentHash}\0${source.commit}`);
    if (reviews.size >= 128) reviews.delete(reviews.keys().next().value!);
    reviews.set(reviewToken, { install: record, source, currentHash });
    return {
      installId: record.id,
      fromCommit: record.commit,
      toCommit: source.commit,
      currentHash,
      modified: currentHash !== record.hash,
      reviewToken,
      ...preview,
    };
  });
  const update = Effect.fn("SkillRegistry.update")(function* (input: SkillUpdateInput) {
    const review = reviews.get(input.reviewToken);
    if (review === undefined || review.install.id !== input.installId)
      return yield* fail("conflict", "Review the update again before applying it.");
    const current = yield* managed(input.installId, input.projectId);
    if ((yield* files.treeHash(current.directory)) !== review.currentHash)
      return yield* fail(
        "conflict",
        "This skill changed after the update review. Review it again.",
      );
    if (review.currentHash !== current.hash && !input.force)
      return yield* fail(
        "conflict",
        "This skill has local edits. Review them and explicitly replace them before updating.",
      );
    const result = yield* withStaging(path.dirname(current.directory), (stage, preserve) =>
      Effect.gen(function* () {
        const next = path.join(stage, "next");
        yield* stageSkill(review.source, current.subpath, next);
        const updated: SkillRegistryInstall = {
          ...current,
          commit: review.source.commit,
          installedAt: yield* now,
          hash: yield* files.treeHash(next),
        };
        yield* mark(next, updated);
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const backup = yield* moveToTrash(current.directory, review.currentHash);
            const swapped = yield* Effect.uninterruptible(
              fs.rename(next, current.directory).pipe(
                Effect.andThen(
                  store.update((state) => ({
                    ...state,
                    installs: state.installs.map((record) =>
                      record.id === current.id ? { ...updated, removedAt: null } : record,
                    ),
                  })),
                ),
              ),
            ).pipe(Effect.result);
            if (swapped._tag === "Failure") {
              yield* Effect.gen(function* () {
                if (yield* fs.exists(current.directory)) {
                  if ((yield* files.treeHash(current.directory)) !== updated.hash)
                    return yield* fail(
                      "conflict",
                      `The new folder changed during recovery. It remains in place; the previous skill is at ${backup}.`,
                    );
                  yield* fs.rename(current.directory, path.join(stage, "failed-next"));
                }
                yield* fs.copy(backup, current.directory, { overwrite: false });
              }).pipe(
                Effect.tapError(() => Effect.sync(preserve)),
                Effect.mapError((cause) =>
                  isSkillError(cause)
                    ? cause
                    : fail(
                        "io",
                        `The update could not be restored. Your previous skill is preserved at ${backup}; staged files are at ${stage}.`,
                      ),
                ),
              );
              return yield* swapped.failure;
            }
            return updated;
          }),
        );
      }),
    );
    reviews.delete(input.reviewToken);
    yield* changed(input.projectId);
    return result;
  });
  const setEnabled = Effect.fn("SkillRegistry.setEnabled")(function* (input: SkillSetEnabledInput) {
    const entry = yield* entryFor(input);
    const context = yield* catalog.context(input.projectId);
    yield* controls(input, entry, context.cwd).pipe(
      Effect.ensuring(changed(input.projectId).pipe(Effect.ignoreCause({ log: true }))),
    );
    return yield* inventory({ projectId: input.projectId, refresh: true });
  });
  return SkillRegistryService.of({
    inventory: Effect.fn("SkillRegistry.refreshInventory")((input) =>
      (input.refresh ? refreshCatalog(input.projectId) : Effect.void).pipe(
        Effect.andThen(inventory(input)),
      ),
    ),
    validate: Effect.fn("SkillRegistry.validate")((input) =>
      Effect.succeed(validateSkill(input.text, input.folderName)),
    ),
    sources: guarded(
      Effect.map(store.read, (state) => ({
        sources: state.sources,
        installs: state.installs.filter((install) => install.removedAt === null),
        suggested,
      })),
    ),
    fetchSource: Effect.fn("SkillRegistry.fetchSource")((input) =>
      guarded(sourceFiles.start(input)),
    ),
    watchFetch: sourceFiles.watch,
    cancelFetch: Effect.fn("SkillRegistry.cancelFetch")((requestId) =>
      guarded(sourceFiles.cancel(requestId)),
    ),
    install: Effect.fn("SkillRegistry.installLocked")((input) =>
      guarded(mutex.withPermit(install(input))),
    ),
    previewUpdate: Effect.fn("SkillRegistry.previewUpdateLocked")((input) =>
      guarded(mutex.withPermit(previewUpdate(input))),
    ),
    update: Effect.fn("SkillRegistry.updateLocked")((input) =>
      guarded(mutex.withPermit(update(input))),
    ),
    remove: Effect.fn("SkillRegistry.removeLocked")((input) =>
      guarded(mutex.withPermit(remove(input))),
    ),
    readSkill: Effect.fn("SkillRegistry.readSkillChecked")((input) => guarded(readSkill(input))),
    writeSkill: Effect.fn("SkillRegistry.writeSkillLocked")((input) =>
      guarded(mutex.withPermit(writeSkill(input))),
    ),
    scaffold: Effect.fn("SkillRegistry.scaffoldLocked")((input) =>
      guarded(mutex.withPermit(scaffold(input))),
    ),
    setEnabled: Effect.fn("SkillRegistry.setEnabledLocked")((input) =>
      guarded(mutex.withPermit(setEnabled(input))),
    ),
  });
});
export const layer = Layer.effect(SkillRegistryService, make);
