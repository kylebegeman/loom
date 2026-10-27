import type {
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import { slugFromName, type BotDefinitionInput, type BotParameter } from "@t3tools/contracts/fork";

/** Values a draft turns into parameters; later ones stay as written. */
const DRAFT_MAX_PLACEHOLDERS = 6;
const INSTRUCTIONS_MAX = 20_000;
const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;
const DEFAULT_TIMEOUT_MINUTES = 20;
const DEFAULT_MAX_CONCURRENT_RUNS = 2;

type PlaceholderKind = "pr" | "file";

export interface Placeholder {
  readonly name: string;
  readonly kind: PlaceholderKind;
  readonly value: string;
  /** Every way the value was written, so a title can drop it. */
  readonly written: Array<string>;
}

export interface ReplacedInputs {
  readonly text: string;
  readonly placeholders: ReadonlyArray<Placeholder>;
  /** Distinct values past the limit, left as written. */
  readonly leftAsWritten: number;
}

// Code in a brief is an example, not an input, so fenced blocks are never rewritten.
const FENCE = /(```[\s\S]*?(?:```|$))/;

// One pass, so values are numbered in reading order: a URL (only a pull request URL's number is
// an input), "PR 12" or "pull request #12", "#12", then a path with a directory and an extension.
const INPUT =
  /(https?:\/\/[^\s<>()"'`\]]+)|\b(PR|pull request)(\s*#?\s*)(\d+)\b|(?<![\w&#/])#(\d+)\b|(?<![\w@./:-])((?:\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@-][\w@.-]*\.[A-Za-z][A-Za-z0-9]*)(?![\w/])/gi;

/** Swaps pull request numbers and file paths for `{{pr}}`, `{{file}}`, `{{file2}}` and so on. */
export const replaceInputs = (text: string, limit = DRAFT_MAX_PLACEHOLDERS): ReplacedInputs => {
  const byValue = new Map<string, Placeholder>();
  const overflow = new Set<string>();
  const counts: Record<PlaceholderKind, number> = { pr: 0, file: 0 };
  const placeholder = (kind: PlaceholderKind, value: string, written: string) => {
    const key = `${kind}:${value}`;
    let found = byValue.get(key);
    if (found === undefined) {
      if (byValue.size >= limit) {
        overflow.add(key);
        return null;
      }
      counts[kind] += 1;
      found = {
        name: counts[kind] === 1 ? kind : `${kind}${counts[kind]}`,
        kind,
        value,
        written: [],
      };
      byValue.set(key, found);
    }
    if (!found.written.includes(written)) found.written.push(written);
    return `{{${found.name}}}`;
  };

  const rewrite = (prose: string) =>
    prose.replace(
      INPUT,
      (
        match: string,
        url: string | undefined,
        prWord: string | undefined,
        prGap: string | undefined,
        prNumber: string | undefined,
        hashNumber: string | undefined,
        path: string | undefined,
      ) => {
        if (url !== undefined) {
          const pull = /\/pull\/(\d+)/.exec(url);
          if (pull?.[1] === undefined) return match;
          const name = placeholder("pr", pull[1], match);
          return name === null ? match : url.replace(`/pull/${pull[1]}`, `/pull/${name}`);
        }
        if (prWord !== undefined && prNumber !== undefined) {
          const name = placeholder("pr", prNumber, match);
          return name === null ? match : `${prWord}${prGap ?? " "}${name}`;
        }
        if (hashNumber !== undefined) {
          const name = placeholder("pr", hashNumber, match);
          return name === null ? match : `#${name}`;
        }
        if (path !== undefined) return placeholder("file", path, path) ?? match;
        return match;
      },
    );

  const rewritten = text
    .split(FENCE)
    .map((part, index) => (index % 2 === 1 ? part : rewrite(part)))
    .join("");
  return { text: rewritten, placeholders: [...byValue.values()], leftAsWritten: overflow.size };
};

const LABELS: Record<PlaceholderKind, string> = { pr: "Pull request", file: "File" };

const toParameter = (placeholder: Placeholder): BotParameter => {
  const ordinal = placeholder.name.slice(placeholder.kind.length);
  return {
    name: placeholder.name,
    label: ordinal === "" ? LABELS[placeholder.kind] : `${LABELS[placeholder.kind]} ${ordinal}`,
    description: `For example ${placeholder.value}`.slice(0, DESCRIPTION_MAX),
    type: placeholder.kind === "pr" ? "number" : "string",
    required: true,
  };
};

const DANGLING = /(?:[\s,:;.-]+|\s+\b(?:in|on|for|of|at|to|from|and|with)\b)+$/i;

/** The thread title without the values that became inputs, so "Fix #12" names the job. */
const nameFrom = (title: string, placeholders: ReadonlyArray<Placeholder>) => {
  let name = title;
  for (const placeholder of placeholders) {
    const forms =
      placeholder.kind === "pr"
        ? [...placeholder.written, `#${placeholder.value}`]
        : placeholder.written;
    for (const form of forms) name = name.split(form).join(" ");
  }
  name = name
    .replace(/\s+/g, " ")
    .trim()
    .replace(DANGLING, "")
    .replace(/^[\s,:;.-]+/, "");
  return (name === "" ? "New bot" : name).slice(0, NAME_MAX).trim();
};

/** `base`, or `base-2`, `base-3` and so on when taken, always a valid bot id. */
const uniqueBotId = (name: string, taken: ReadonlySet<string>) => {
  const base = slugFromName(name) || "bot";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
};

export interface DraftSource {
  readonly brief: string;
  readonly attachments: number;
  readonly title: string;
  readonly projectId: ProjectId;
  /** A thread in the scratch project gives a scratch bot. */
  readonly scratch: boolean;
  readonly worktreePath: string | null;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** A bot drawn from a thread's opening brief. Never saved here; the editor or an agent saves it. */
export const draftFromBrief = (source: DraftSource, takenIds: ReadonlySet<string>) => {
  const replaced = replaceInputs(source.brief.trim());
  const notes: Array<string> = [];
  const count = replaced.placeholders.length;
  if (count > 0)
    notes.push(
      `${count} ${plural(count, "value became a parameter", "values became parameters")}.`,
    );
  if (replaced.leftAsWritten > 0)
    notes.push(
      `Only the first ${DRAFT_MAX_PLACEHOLDERS} values became parameters; ${replaced.leftAsWritten} more ${plural(replaced.leftAsWritten, "was", "were")} left as written.`,
    );
  if (replaced.text.length > INSTRUCTIONS_MAX)
    notes.push("The brief was cut to 20,000 characters.");
  if (source.attachments > 0)
    notes.push("The first message had attachments, which a bot cannot carry; they were left out.");
  const worktree = !source.scratch && source.worktreePath !== null;
  if (worktree) notes.push("The thread used a worktree, so each run gets a new worktree too.");

  const name = nameFrom(source.title, replaced.placeholders);
  const draft: BotDefinitionInput = {
    id: uniqueBotId(name, takenIds),
    name,
    description: "",
    instructions: replaced.text.slice(0, INSTRUCTIONS_MAX).trim(),
    parameters: replaced.placeholders.map(toParameter),
    modelSelection: source.modelSelection,
    runtimeMode: source.runtimeMode,
    interactionMode: source.interactionMode,
    workspace: source.scratch
      ? { type: "scratch" }
      : { type: "project", projectId: source.projectId, worktree },
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
    maxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
    scopeProjectId: source.scratch ? null : source.projectId,
  };
  return { draft, notes };
};
