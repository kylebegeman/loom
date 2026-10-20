import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";

// A neutral extension keeps the renderer from guessing a language and highlighting prose.
const FILE_NAME = "text.txt";

/** Upstream's diff renderer over the two inputs; the summary above it comes from the tool. */
export function DiffToolView({
  original,
  changed,
  view,
  ignoreWhitespace,
}: {
  readonly original: string;
  readonly changed: string;
  readonly view: "unified" | "split";
  readonly ignoreWhitespace: boolean;
}) {
  const { resolvedTheme } = useTheme();
  if (original === changed) return null;
  const diff = parseDiffFromFile(
    { name: FILE_NAME, contents: original },
    { name: FILE_NAME, contents: changed },
    { ignoreWhitespace },
  );
  if (diff.hunks.length === 0) return null;
  return (
    <div className="max-h-96 overflow-auto rounded-lg border text-xs" aria-label="Differences">
      <FileDiff
        fileDiff={diff}
        options={{
          diffStyle: view,
          theme: resolveDiffThemeName(resolvedTheme),
          overflow: "wrap",
          disableFileHeader: true,
        }}
      />
    </div>
  );
}
