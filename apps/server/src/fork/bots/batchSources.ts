import type { ProjectId } from "@t3tools/contracts";
import { BOTS_BATCH_MAX_ITEMS, BotsError, type BotBatchSource } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { PullRequestService } from "../../pullRequest/PullRequestService.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";

export const BATCH_LABEL_MAX = 120;
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const CONTENT_SEARCH_LIMIT = 500;

export interface SourceItem {
  readonly label: string;
  readonly value: string | number;
}

export interface ResolvedSource {
  readonly items: ReadonlyArray<SourceItem>;
  /** For example "apps/web/src/**\/*.tsx, 31 files". */
  readonly summary: string;
  readonly note: string | null;
}

/** Where a file source reads from: the project root or a thread's worktree. */
export interface SourceCheckout {
  readonly projectId: ProjectId;
  readonly cwd: string;
}

const refuse = (message: string) => new BotsError({ reason: "invalid", message });

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message !== "" ? error.message : String(error);

export const cutLabel = (text: string) =>
  text.length <= BATCH_LABEL_MAX ? text : `${text.slice(0, BATCH_LABEL_MAX - 1)}…`;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Refuses more than a batch can hold, naming how many were found. */
const bounded = (found: number, noun: string) =>
  found > BOTS_BATCH_MAX_ITEMS
    ? Effect.fail(
        refuse(
          `This source found ${found} ${noun}s. Narrow it to ${BOTS_BATCH_MAX_ITEMS} or fewer.`,
        ),
      )
    : Effect.void;

/** One item per non-empty trimmed line; exact duplicates are dropped, order is kept. */
export const splitLines = (text: string): ReadonlyArray<string> => [
  ...new Set(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  ),
];

const paths = (items: ReadonlyArray<string>): ReadonlyArray<SourceItem> =>
  items.map((path) => ({ label: cutLabel(path), value: path }));

export const makeBatchSources = Effect.gen(function* () {
  const git = yield* GitVcsDriver;
  const pullRequests = yield* PullRequestService;
  const entries = yield* WorkspaceEntries;

  const gitPaths = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    git
      .execute({
        operation,
        cwd,
        args,
        timeoutMs: GIT_TIMEOUT_MS,
        maxOutputBytes: GIT_MAX_OUTPUT_BYTES,
      })
      .pipe(
        Effect.mapError((error) => refuse(`Git could not list the files: ${errorMessage(error)}`)),
        Effect.flatMap((result) =>
          result.stdoutTruncated
            ? Effect.fail(
                refuse(
                  `This source found too many files. Narrow it to ${BOTS_BATCH_MAX_ITEMS} or fewer.`,
                ),
              )
            : // ls-files lists a conflicted path once per merge stage.
              Effect.succeed([...new Set(result.stdout.split("\0").filter((path) => path !== ""))]),
        ),
      );

  const requireCheckout = (checkout: SourceCheckout | null) =>
    checkout === null
      ? Effect.fail(refuse("Choose a project for a file source."))
      : Effect.succeed(checkout);

  const resolve = Effect.fn("BotBatchSources.resolve")(function* (
    source: Exclude<BotBatchSource, { readonly type: "inputs" }>,
    checkout: SourceCheckout | null,
  ) {
    switch (source.type) {
      case "lines": {
        const lines = splitLines(source.text);
        if (lines.length === 0) return yield* refuse("Paste at least one line.");
        yield* bounded(lines.length, "line");
        return {
          items: lines.map((line) => ({ label: cutLabel(line), value: line })),
          summary: `Pasted lines, ${plural(lines.length, "item")}`,
          note: null,
        } satisfies ResolvedSource;
      }
      case "glob": {
        // Other pathspec magic and NUL would change what git matches beyond a glob.
        if (source.pattern.startsWith(":") || source.pattern.includes("\0"))
          return yield* refuse("Use a plain glob pattern such as apps/web/src/**/*.tsx.");
        const { cwd } = yield* requireCheckout(checkout);
        // Tracked files only, which keeps build output and node_modules out without an ignore pass.
        const found = yield* gitPaths("bots.batch.glob", cwd, [
          "ls-files",
          "-z",
          "--cached",
          "--",
          `:(glob)${source.pattern}`,
        ]);
        if (found.length === 0) return yield* refuse(`No tracked file matches ${source.pattern}.`);
        yield* bounded(found.length, "file");
        return {
          items: paths(found),
          summary: `${source.pattern}, ${plural(found.length, "file")}`,
          note: null,
        } satisfies ResolvedSource;
      }
      case "conflicts": {
        const { cwd } = yield* requireCheckout(checkout);
        const found = yield* gitPaths("bots.batch.conflicts", cwd, [
          "diff",
          "--name-only",
          "--diff-filter=U",
          "-z",
        ]);
        if (found.length === 0) return yield* refuse("No conflicted files in this checkout.");
        yield* bounded(found.length, "file");
        return {
          items: paths(found),
          summary: `Merge conflicts, ${plural(found.length, "file")}`,
          note: null,
        } satisfies ResolvedSource;
      }
      case "pullRequests": {
        const { projectId } = yield* requireCheckout(checkout);
        const result = yield* pullRequests
          .list({
            state: "open",
            projectId,
            limit: BOTS_BATCH_MAX_ITEMS + 1,
            ...(source.query === undefined ? {} : { query: source.query }),
          })
          .pipe(
            Effect.mapError((error) =>
              refuse(`Loom could not list pull requests: ${errorMessage(error)}`),
            ),
          );
        const unavailable = result.providers.find(
          (provider) => !provider.configured && provider.detail !== null,
        );
        if (result.entries.length === 0 && unavailable?.detail != null)
          return yield* refuse(unavailable.detail);
        if (result.entries.length === 0)
          return yield* refuse("No open pull request matches this source.");
        yield* bounded(result.entries.length, "pull request");
        const errors = result.errors.map((error) => `${error.projectTitle}: ${error.message}`);
        return {
          items: result.entries.map((entry) => ({
            label: cutLabel(`#${entry.number} ${entry.title}`),
            value: entry.number,
          })),
          summary: `Open pull requests${source.query === undefined ? "" : ` matching ${source.query}`}, ${result.entries.length}`,
          note:
            errors.length === 0
              ? null
              : `Some pull requests could not be read. ${errors.join(" ")}`,
        } satisfies ResolvedSource;
      }
      case "search": {
        const { cwd } = yield* requireCheckout(checkout);
        if (source.mode === "files") {
          const result = yield* entries
            .search({ cwd, query: source.query.trim(), limit: BOTS_BATCH_MAX_ITEMS, kind: "file" })
            .pipe(Effect.mapError((error) => refuse(`The search failed: ${errorMessage(error)}`)));
          const found = result.entries.map((entry) => entry.path);
          if (found.length === 0) return yield* refuse(`No file name matches ${source.query}.`);
          return {
            items: paths(found),
            summary: `Files named like ${source.query}, ${found.length}`,
            // An index cap is not the same as "these are all the matches".
            note: result.truncated
              ? `The search stopped at ${found.length} files; there may be more matches.`
              : null,
          } satisfies ResolvedSource;
        }
        const result = yield* entries
          .searchContents({
            cwd,
            query: source.query,
            limit: CONTENT_SEARCH_LIMIT,
            caseSensitive: source.caseSensitive ?? false,
            wholeWord: false,
            useRegex: source.useRegex ?? false,
          })
          .pipe(Effect.mapError((error) => refuse(`The search failed: ${errorMessage(error)}`)));
        const found = [...new Set(result.matches.map((match) => match.path))];
        if (found.length === 0) return yield* refuse(`No file contains ${source.query}.`);
        yield* bounded(found.length, "file");
        const notes = [
          ...(result.truncated
            ? [
                `The search stopped at ${CONTENT_SEARCH_LIMIT} matching lines; there may be more files.`,
              ]
            : []),
          ...(result.regexFallbackError === undefined
            ? []
            : [`The pattern was searched as text: ${result.regexFallbackError}`]),
        ];
        return {
          items: paths(found),
          summary: `Files containing ${source.query}, ${found.length}`,
          note: notes.length === 0 ? null : notes.join(" "),
        } satisfies ResolvedSource;
      }
    }
  });

  return { resolve };
});

export type BatchSources = Effect.Success<typeof makeBatchSources>;
