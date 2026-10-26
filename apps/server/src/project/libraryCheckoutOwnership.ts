import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";
import * as SetupMarker from "../workspace/setupMarker.ts";

/** Receipts own physical locations even when local project IDs or path spellings differ. */
export const makeLibraryCheckoutOwners = Effect.gen(function* () {
  const store = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const key = SetupMarker.pathKey(yield* HostProcess.Platform);
  const contains = (root: string, target: string) => {
    const relative = path.relative(key(root), key(target));
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  };
  const canonical = Effect.fn("ProjectCheckout.canonicalLibraryPath")(function* (target: string) {
    const resolved = path.resolve(target);
    let ancestor = resolved;
    while (!(yield* fs.exists(ancestor)) && path.dirname(ancestor) !== ancestor)
      ancestor = path.dirname(ancestor);
    return path.resolve(yield* fs.realPath(ancestor), path.relative(ancestor, resolved));
  });
  return Effect.fn("ProjectCheckout.libraryCheckoutOwners")(function* (cwd: string) {
    const receipts = yield* store.receipts;
    if (receipts.length === 0) return [];
    const target = path.resolve(cwd);
    const realTarget = yield* canonical(target);
    const matches: LibraryWorkspaceStore.WorkspaceReceipt[] = [];
    for (const receipt of receipts) {
      // Removing a listing does not remove its bindings or the managed recovery owner.
      for (const location of [
        receipt.copy.rootPath,
        ...receipt.copy.repositories.map((repository) => repository.path),
        ...(receipt.removalPath === null ? [] : [receipt.removalPath]),
      ]) {
        const root = path.resolve(location);
        const realRoot = yield* canonical(root);
        if (
          contains(root, target) ||
          contains(target, root) ||
          contains(realRoot, realTarget) ||
          contains(realTarget, realRoot)
        ) {
          matches.push(receipt);
          break;
        }
      }
    }
    return matches;
  });
});
