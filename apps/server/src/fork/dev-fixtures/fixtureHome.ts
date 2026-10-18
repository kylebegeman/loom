// @effect-diagnostics nodeBuiltinImport:off -- Pure fixture comparisons use host platform path rules.
import * as NodePath from "node:path";
const contains = (parent: string, child: string) => {
  const relative = NodePath.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${NodePath.sep}`) &&
      relative !== ".." &&
      !NodePath.isAbsolute(relative))
  );
};
/** All arguments are canonical paths; the recognized home is derived from the Git worktree root. */
export const isProtectedFixturePath = (
  target: string,
  sharedHome: string,
  baseDir: string,
  recognizedHome: string | null,
) => contains(sharedHome, target) && (baseDir !== recognizedHome || !contains(baseDir, target));
