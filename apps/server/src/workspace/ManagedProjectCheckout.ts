// fork: project-lifecycle
import { ProjectId, RepositoryIdentity, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import { fileIdentity } from "../fork/fileIdentity.ts";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { runCheckoutProcess } from "./checkoutProcess.ts";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import {
  archiveScratchCheckout,
  restoreScratchCheckout,
  scratchArchiveMatches,
  scratchCheckoutOwned,
  type ScratchCheckoutManifest,
} from "./ScratchCheckout.ts";
import { ProjectCheckoutRetention } from "@t3tools/contracts/fork";
import { withWorkspaceLease } from "./workspaceLease.ts";
import * as SetupMarker from "./setupMarker.ts";

class ManagedProjectCheckoutError extends Schema.TaggedError<ManagedProjectCheckoutError>()(
  "ManagedProjectCheckoutError",
  { message: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {}

const LegacyReceipt = Schema.Struct({
  version: Schema.Literal(1),
  workspaceRoot: Schema.String,
  repositoryIdentity: RepositoryIdentity,
  projectId: Schema.NullOr(ProjectId),
  checkoutInode: Schema.Number,
  gitInode: Schema.Number,
  device: Schema.Number,
  uid: Schema.Number,
  birthtime: Schema.NullOr(Schema.Number),
  released: Schema.Boolean,
  removalPath: Schema.NullOr(Schema.String),
});
const CurrentReceipt = Schema.Struct({
  ...LegacyReceipt.fields,
  version: Schema.Literal(2),
  ownershipSource: Schema.Literals(["clone", "adopted"]),
  retention: ProjectCheckoutRetention,
});
const Receipt = Schema.Union([LegacyReceipt, CurrentReceipt]);
type ManagedProjectCheckoutReceipt = Omit<typeof CurrentReceipt.Type, "version"> & {
  readonly version: 1 | 2;
};
const Codec = Schema.fromJsonString(Receipt);
const decode = Schema.decodeEffect(Codec);
const encode = Schema.encodeEffect(Codec);
const fail = (message: string) => new ManagedProjectCheckoutError({ message });
/** Receipts live in T3 home, keyed by the canonical checkout path. */
export const ownershipReceiptPath = Effect.fnUntraced(function* (cwd: string) {
  const path = yield* Path.Path;
  return path.join(
    yield* SetupMarker.stateDirectory(),
    "project-ownership",
    `${SetupMarker.digestPath(yield* SetupMarker.canonicalPath(cwd))}.json`,
  );
});
/** Older versions wrote the receipt beside the checkout; the install that wrote it migrates it on first read. */
const legacyReceiptPath = (cwd: string) => `${cwd}.t3-project-owned.json`;
const isManagedError = Schema.is(ManagedProjectCheckoutError);
const mapFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) =>
      isManagedError(error)
        ? error
        : new ManagedProjectCheckoutError({
            message: "The managed project checkout could not be prepared safely.",
            cause: error,
          }),
    ),
  );

const canonicalPath = SetupMarker.canonicalPath;

const writeReceipt = Effect.fnUntraced(function* (receipt: ManagedProjectCheckoutReceipt) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = yield* ownershipReceiptPath(receipt.workspaceRoot);
  const legacy = legacyReceiptPath(receipt.workspaceRoot);
  const ownsLegacy = yield* SetupMarker.ownsLegacyMetadata();
  if (!ownsLegacy && !(yield* fs.exists(target)) && (yield* fs.exists(legacy)))
    return yield* fail("Another Loom install manages this checkout.");
  yield* fs.makeDirectory(path.dirname(target), { recursive: true, mode: 0o700 });
  const stage = `${target}.pending-${yield* randomUuidV4}`;
  yield* Effect.gen(function* () {
    yield* fs.writeFileString(stage, yield* encode({ ...receipt, version: 2 }), {
      flag: "wx",
      mode: 0o600,
    });
    yield* Effect.scoped(fs.open(stage).pipe(Effect.flatMap((file) => file.sync)));
    yield* fs.rename(stage, target);
    yield* Effect.scoped(fs.open(path.dirname(target)).pipe(Effect.flatMap((file) => file.sync)));
  }).pipe(Effect.ensuring(fs.remove(stage, { force: true }).pipe(Effect.ignore)));
  if (ownsLegacy) yield* fs.remove(legacy, { force: true });
});

/** Any receipt, released or not, keeps its folder name from being claimed for new work. */
export const hasManagedProjectReceipt = Effect.fn("ManagedProjectCheckout.hasReceipt")(function* (
  workspaceRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* canonicalPath(workspaceRoot);
  return (
    (yield* fs.exists(yield* ownershipReceiptPath(cwd))) ||
    (yield* fs.exists(legacyReceiptPath(cwd)))
  );
});

/** Clones and explicitly reviewed adoption create ownership proof. Opening a folder does not. */
export const markManagedProjectCheckout = Effect.fn("ManagedProjectCheckout.mark")(function* (
  workspaceRoot: string,
  repositoryIdentity: RepositoryIdentity,
  options?: {
    readonly ownershipSource: "clone" | "adopted";
    readonly retention: typeof ProjectCheckoutRetention.Type;
    readonly projectId: ProjectId;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* canonicalPath(workspaceRoot);
  if ((yield* fs.realPath(cwd)) !== cwd) return yield* fail("The clone is a symbolic link.");
  if (
    (yield* fs.exists(yield* ownershipReceiptPath(cwd))) ||
    (yield* fs.exists(legacyReceiptPath(cwd)))
  )
    return yield* fail("A managed project receipt already exists for this folder.");
  const root = yield* fs.stat(cwd);
  const git = yield* fs.stat(path.join(cwd, ".git"));
  const rootId = fileIdentity(root);
  const gitId = fileIdentity(git);
  const uid = yield* HostProcess.UserId;
  if (
    uid === undefined ||
    root.type !== "Directory" ||
    git.type !== "Directory" ||
    Option.getOrNull(root.uid) !== uid ||
    Option.getOrNull(git.uid) !== uid ||
    rootId.inode === null ||
    gitId.inode === null ||
    rootId.device === null ||
    rootId.device !== gitId.device
  )
    return yield* fail("Clone ownership could not be proven on this filesystem.");
  if ((yield* fs.realPath(path.join(cwd, ".git"))) !== path.join(cwd, ".git"))
    return yield* fail("The clone uses an external Git directory.");
  yield* writeReceipt({
    version: 2,
    workspaceRoot: cwd,
    repositoryIdentity: { ...repositoryIdentity, rootPath: cwd },
    projectId: options?.projectId ?? null,
    ownershipSource: options?.ownershipSource ?? "clone",
    retention: options?.retention ?? "inherit",
    checkoutInode: rootId.inode,
    gitInode: gitId.inode,
    device: rootId.device,
    uid,
    birthtime: Option.map(root.birthtime, (date) => date.getTime()).pipe(Option.getOrNull),
    released: false,
    removalPath: null,
  });
}, mapFailure);

/** Metadata remains readable when the checkout is absent, including after a server restart. */
export const readManagedProjectCheckout = Effect.fn("ManagedProjectCheckout.read")(function* (
  workspaceRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* canonicalPath(workspaceRoot);
  const current = yield* ownershipReceiptPath(cwd);
  const legacy = !(yield* fs.exists(current));
  const target = legacy ? legacyReceiptPath(cwd) : current;
  if (!(yield* fs.exists(target))) return null;
  if ((yield* fs.realPath(target)) !== target)
    return yield* fail("The project receipt is a symbolic link.");
  const info = yield* fs.stat(target);
  const uid = yield* HostProcess.UserId;
  if (
    uid === undefined ||
    info.type !== "File" ||
    Option.getOrNull(info.uid) !== uid ||
    Number(info.size) > 64 * 1024
  )
    return yield* fail("The project receipt is not owned by this host.");
  const receipt = yield* decode(yield* fs.readFileString(target));
  if (receipt.workspaceRoot !== cwd || receipt.uid !== uid)
    return yield* fail("The project receipt belongs to a different folder or host.");
  const read = {
    ...receipt,
    ownershipSource: receipt.version === 2 ? receipt.ownershipSource : "clone",
    retention: receipt.version === 2 ? receipt.retention : "inherit",
  } satisfies ManagedProjectCheckoutReceipt;
  if (legacy && (yield* SetupMarker.ownsLegacyMetadata())) yield* writeReceipt(read);
  return read;
}, mapFailure);

export const assertManagedProjectOwned = Effect.fn("ManagedProjectCheckout.assertOwned")(function* (
  receipt: ManagedProjectCheckoutReceipt,
  target = receipt.workspaceRoot,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if ((yield* fs.realPath(target)) !== target)
    return yield* fail("The managed checkout is a symbolic link.");
  if ((yield* fs.realPath(path.join(target, ".git"))) !== path.join(target, ".git"))
    return yield* fail("The managed checkout uses an external Git directory.");
  const root = yield* fs.stat(target);
  const git = yield* fs.stat(path.join(target, ".git"));
  const rootId = fileIdentity(root);
  const gitId = fileIdentity(git);
  if (
    root.type !== "Directory" ||
    git.type !== "Directory" ||
    rootId.device !== receipt.device ||
    gitId.device !== receipt.device ||
    Option.getOrNull(root.uid) !== receipt.uid ||
    Option.getOrNull(git.uid) !== receipt.uid ||
    rootId.inode !== receipt.checkoutInode ||
    gitId.inode !== receipt.gitInode ||
    Option.map(root.birthtime, (date) => date.getTime()).pipe(Option.getOrNull) !==
      receipt.birthtime
  )
    return yield* fail("The checkout was replaced or its ownership changed.");
}, mapFailure);

/** Call under the workspace lease when changing reviewed project metadata. */
export const setManagedProjectRetention = Effect.fn("ManagedProjectCheckout.setRetention")(
  function* (
    workspaceRoot: string,
    retention: typeof ProjectCheckoutRetention.Type,
    projectId: ProjectId,
    workspaceLeaseHeld = false,
  ) {
    const path = yield* Path.Path;
    const cwd = path.resolve(workspaceRoot);
    const update = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const receipt = yield* readManagedProjectCheckout(cwd);
      if (receipt === null) return yield* fail("This project is not a managed checkout.");
      if (receipt.projectId !== null && receipt.projectId !== projectId)
        return yield* fail("The managed checkout belongs to another project.");
      if (yield* fs.exists(cwd)) yield* assertManagedProjectOwned(receipt);
      else if (!receipt.released) return yield* fail("The managed checkout is missing.");
      yield* writeReceipt({ ...receipt, projectId, retention });
    });
    return yield* workspaceLeaseHeld ? update : withWorkspaceLease(cwd, update);
  },
  mapFailure,
);

const recoveryInput = (receipt: ManagedProjectCheckoutReceipt, projectId: ProjectId) => ({
  scratchRoot: receipt.workspaceRoot.replace(/[\\/][^\\/]+$/, ""),
  worktreePath: receipt.workspaceRoot,
  projectId,
  // This archive belongs to the project, independent of which conversation resumes it.
  threadId: ThreadId.make(`managed-project:${projectId}`),
  recoveryKind: "project" as const,
});

export const archiveManagedProjectCheckout = Effect.fn("ManagedProjectCheckout.archive")(function* (
  receipt: ManagedProjectCheckoutReceipt,
  projectId: ProjectId,
) {
  if (receipt.projectId !== null && receipt.projectId !== projectId)
    return yield* fail("The managed checkout belongs to another project.");
  yield* assertManagedProjectOwned(receipt);
  const input = recoveryInput(receipt, projectId);
  const archive = yield* archiveScratchCheckout(input);
  return { input, archive };
}, mapFailure);

const LISTED_WORKTREES = 3;

/**
 * Linked worktrees outside the checkout keep their Git metadata inside it, so removing the
 * checkout breaks them and strands their work. Only an entry Git marks prunable is already
 * broken. A locked one may sit on unplugged media, which Git never calls prunable, so a locked
 * or unreadable entry counts as outside.
 */
const externalLinkedWorktrees = Effect.fn("ManagedProjectCheckout.externalWorktrees")(function* (
  workspaceRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const list = (format: ReadonlyArray<string>) =>
    runCheckoutProcess({
      command: "git",
      args: ["-C", workspaceRoot, "worktree", "list", "--porcelain", ...format],
      timeout: "30 seconds",
      maxOutputBytes: 1024 * 1024,
      outputMode: "truncate",
    });
  // Git before 2.36 rejects -z; its line form differs only in the separator.
  const terminated = yield* list(["-z"]);
  const listed = terminated.code === 0 ? terminated : yield* list([]);
  if (listed.code !== 0 || listed.stdoutTruncated)
    return yield* fail("The project's linked worktrees could not be listed.");
  const entries: Array<{ path: string; prunable: boolean; locked: boolean }> = [];
  for (const field of listed.stdout.split(terminated.code === 0 ? "\0" : "\n")) {
    const entry = entries.at(-1);
    if (field.startsWith("worktree "))
      entries.push({ path: field.slice("worktree ".length), prunable: false, locked: false });
    else if (entry === undefined) continue;
    else if (field === "prunable" || field.startsWith("prunable ")) entry.prunable = true;
    else if (field === "locked" || field.startsWith("locked ")) entry.locked = true;
  }
  const external: string[] = [];
  for (const entry of entries) {
    if (entry.locked) {
      external.push(entry.path);
      continue;
    }
    if (entry.prunable) continue;
    const actual = yield* fs.realPath(entry.path).pipe(Effect.orElseSucceed(() => null));
    const relative = actual === null ? null : path.relative(workspaceRoot, actual);
    if (
      relative === null ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      external.push(entry.path);
  }
  return external.toSorted();
});

/** A durable tombstone makes a crash during recursive removal recoverable. */
export const releaseManagedProjectCheckout = Effect.fn("ManagedProjectCheckout.release")(function* (
  receipt: ManagedProjectCheckoutReceipt,
  projectId: ProjectId,
  archive: ScratchCheckoutManifest,
) {
  const fs = yield* FileSystem.FileSystem;
  if (receipt.projectId !== null && receipt.projectId !== projectId)
    return yield* fail("The managed checkout belongs to another project.");
  yield* assertManagedProjectOwned(receipt);
  if (receipt.removalPath !== null && (yield* fs.exists(receipt.removalPath)))
    return yield* fail(
      "A previous project recovery folder is retained; inspect it before releasing again.",
    );
  const linked = yield* externalLinkedWorktrees(receipt.workspaceRoot);
  if (linked.length > 0) {
    const more = linked.length - LISTED_WORKTREES;
    return yield* fail(
      `Worktrees made from this project still exist: ${linked.slice(0, LISTED_WORKTREES).join(", ")}${more > 0 ? ` and ${more} more` : ""}. Land or remove them first. Releasing the project would break them.`,
    );
  }
  if (!(yield* scratchArchiveMatches(archive)))
    return yield* fail("The project changed while archiving.");
  const removalPath = `${receipt.workspaceRoot}.t3-released-${yield* randomUuidV4}`;
  const released = { ...receipt, projectId, released: true, removalPath };
  yield* writeReceipt(released);
  yield* fs.rename(receipt.workspaceRoot, removalPath);
  // Verify the moved tree before any recursive mutation. Its archive has already been synced.
  yield* assertManagedProjectOwned(released, removalPath);
  yield* scratchCheckoutOwned({ ...recoveryInput(released, projectId), worktreePath: removalPath });
  if (!(yield* scratchArchiveMatches({ ...archive, worktreePath: removalPath })))
    return yield* fail("The project changed during release; its recovery folder is retained.");
  // Cwd-dependent tools now see the sibling, not the original path. A final status
  // check catches files written during the move, after the caller's last check.
  const status = yield* runCheckoutProcess({
    command: "git",
    args: ["-C", removalPath, "status", "--porcelain=v1", "--untracked-files=all", "-z"],
    timeout: "30 seconds",
    maxOutputBytes: 64 * 1024,
    outputMode: "truncate",
  });
  const ignored = yield* runCheckoutProcess({
    command: "git",
    args: [
      "-C",
      removalPath,
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ],
    timeout: "30 seconds",
    maxOutputBytes: 64 * 1024,
    outputMode: "truncate",
  });
  if (
    status.code !== 0 ||
    status.stdoutTruncated ||
    status.stdout !== "" ||
    ignored.code !== 0 ||
    ignored.stdoutTruncated ||
    ignored.stdout.split("\0").some((file) => file !== "" && !/(^|\/)node_modules\/$/.test(file))
  )
    return yield* fail("Local files changed during release; the recovery folder is retained.");
  yield* fs.remove(removalPath, { recursive: true });
  yield* writeReceipt({ ...released, removalPath: null });
  yield* SetupMarker.clear(receipt.workspaceRoot);
}, mapFailure);

/**
 * An unreleased receipt whose folder is gone means the folder was moved by hand. The receipt
 * follows it when the new folder is the same checkout, and is retired otherwise, so the new
 * location starts external and can be adopted after review.
 */
export const relocateManagedProjectCheckout = Effect.fn("ManagedProjectCheckout.relocate")(
  function* (previousRoot: string, nextRoot: string) {
    const path = yield* Path.Path;
    const relocate = Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const receipt = yield* readManagedProjectCheckout(previousRoot);
      if (receipt === null) return;
      if (receipt.released || (yield* fs.exists(receipt.workspaceRoot)))
        return yield* fail(
          "Loom manages this folder's location and recovery. Its location cannot be changed.",
        );
      const current = yield* ownershipReceiptPath(receipt.workspaceRoot);
      // Another install's legacy sidecar stays as it is; this install never took it over.
      if (!(yield* fs.exists(current))) return;
      const next = yield* canonicalPath(nextRoot);
      const sameCheckout =
        (yield* fs.exists(next)) &&
        Exit.isSuccess(yield* Effect.exit(assertManagedProjectOwned(receipt, next)));
      if (sameCheckout) {
        if (yield* hasManagedProjectReceipt(next))
          return yield* fail("A managed project receipt already exists for the new folder.");
        yield* writeReceipt({
          ...receipt,
          workspaceRoot: next,
          repositoryIdentity: { ...receipt.repositoryIdentity, rootPath: next },
        });
      }
      yield* fs.remove(current, { force: true });
    });
    return yield* withWorkspaceLease(path.resolve(previousRoot), relocate);
  },
  mapFailure,
);

/** Restore files on explicit use. Setup remains a separate retryable provider/launch stage. */
export const restoreManagedProjectCheckout = Effect.fn("ManagedProjectCheckout.restore")(function* (
  workspaceRoot: string,
  workspaceLeaseHeld = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = path.resolve(workspaceRoot);
  const restore = Effect.gen(function* () {
    // Re-read state under the lease. Two clients can request the same released
    // checkout at once, and the later caller should use the first restoration.
    if (yield* fs.exists(cwd)) {
      const interrupted = yield* readManagedProjectCheckout(cwd);
      if (interrupted === null || !interrupted.released) return false;
      // A failed rename can leave the verified original checkout beside a durable tombstone.
      // Explicit use cancels that incomplete release without trusting a replacement folder.
      yield* assertManagedProjectOwned(interrupted);
      yield* writeReceipt({
        ...interrupted,
        released: false,
        removalPath:
          interrupted.removalPath !== null && (yield* fs.exists(interrupted.removalPath))
            ? interrupted.removalPath
            : null,
      });
      return true;
    }
    const receipt = yield* readManagedProjectCheckout(cwd);
    if (receipt === null || !receipt.released || receipt.projectId === null) return false;
    const projectId = receipt.projectId;
    const restored = yield* restoreScratchCheckout({
      ...recoveryInput(receipt, projectId),
      workspaceLeaseHeld: true,
    });
    if (!restored) return yield* fail("The managed project's recovery archive is unavailable.");
    const root = yield* fs.stat(receipt.workspaceRoot);
    const git = yield* fs.stat(path.join(receipt.workspaceRoot, ".git"));
    const rootId = fileIdentity(root);
    const gitId = fileIdentity(git);
    if (rootId.inode === null || gitId.inode === null)
      return yield* fail("The restored checkout cannot be identified safely.");
    // A partially removed old folder is never reused. It stays retained if deletion was interrupted.
    yield* writeReceipt({
      ...receipt,
      checkoutInode: rootId.inode,
      gitInode: gitId.inode,
      birthtime: Option.map(root.birthtime, (date) => date.getTime()).pipe(Option.getOrNull),
      released: false,
      removalPath:
        receipt.removalPath !== null && (yield* fs.exists(receipt.removalPath))
          ? receipt.removalPath
          : null,
    });
    return true;
  });
  return yield* workspaceLeaseHeld ? restore : withWorkspaceLease(cwd, restore);
}, mapFailure);

const capabilities = (status: string, set: "CapEff" | "CapPrm") => {
  const hex = new RegExp(`^${set}:\\s*([0-9a-f]+)$`, "m").exec(status)?.[1];
  return hex === undefined ? null : BigInt(`0x${hex}`);
};

/** Unknown process visibility keeps data. Inspect cwd without walking package/build trees. */
export const managedProjectProcessReason = Effect.fn("ManagedProjectCheckout.processReason")(
  function* (workspaceRoot: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcess.Platform;
    const uid = yield* HostProcess.UserId;
    const inside = (cwd: string) => {
      const relative = path.relative(workspaceRoot, cwd);
      return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    };
    if (platform === "linux") {
      const own = capabilities(yield* fs.readFileString("/proc/self/status"), "CapEff");
      for (const pid of (yield* fs.readDirectory("/proc")).filter((entry) => /^\d+$/.test(entry))) {
        const directory = `/proc/${pid}`;
        const info = yield* fs.stat(directory).pipe(Effect.option);
        if (Option.isNone(info) || Option.getOrNull(info.value.uid) !== uid) continue;
        const cwd = yield* fs.readLink(`${directory}/cwd`).pipe(Effect.option);
        if (Option.isSome(cwd)) {
          if (inside(cwd.value.replace(/ \(deleted\)$/, "")))
            return "a process is using the project folder";
          continue;
        }
        if (!(yield* fs.exists(directory))) continue;
        // The kernel hides the cwd of a non-dumpable process, whose /proc files turn root-owned,
        // and of one permitted capabilities this server lacks. Login sessions always run such
        // helpers (systemd --user, sd-pam); any other unreadable cwd still keeps the folder.
        const status = yield* fs.stat(`${directory}/status`).pipe(Effect.option);
        if (uid !== 0 && Option.isSome(status) && Option.getOrNull(status.value.uid) === 0)
          continue;
        const theirs = yield* fs.readFileString(`${directory}/status`).pipe(
          Effect.map((text) => capabilities(text, "CapPrm")),
          Effect.orElseSucceed(() => null),
        );
        if (own !== null && theirs !== null && (theirs & ~own) !== 0n) continue;
        return "process working directories could not be verified";
      }
      return null;
    }
    if (platform !== "darwin" || uid === undefined)
      return "process inspection is unavailable on this host";
    const result = yield* runCheckoutProcess({
      command: "/usr/sbin/lsof",
      args: ["-a", "-u", `${uid}`, "-d", "cwd", "-Fn"],
      timeout: "10 seconds",
      maxOutputBytes: 1024 * 1024,
      outputMode: "truncate",
    });
    if (result.code !== 0 || result.stdoutTruncated || result.stderr.trim() !== "")
      return "process working directories could not be verified";
    return result.stdout.split("\n").some((line) => line.startsWith("n") && inside(line.slice(1)))
      ? "a process is using the project folder"
      : null;
  },
  (effect) =>
    effect.pipe(Effect.orElseSucceed(() => "process working directories could not be verified")),
);

/** Explicit project policy takes precedence over environment defaults. */
export const resolveManagedProjectRetention = (
  retention: typeof ProjectCheckoutRetention.Type,
  settings: { readonly projectOnSettle: boolean; readonly projectAfterDays: number | null },
) =>
  retention === "keep"
    ? { projectOnSettle: false, projectAfterDays: null }
    : retention === "release-on-settle"
      ? { projectOnSettle: true, projectAfterDays: null }
      : { projectOnSettle: settings.projectOnSettle, projectAfterDays: settings.projectAfterDays };
