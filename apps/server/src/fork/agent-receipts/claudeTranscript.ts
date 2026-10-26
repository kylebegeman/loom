import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/** Larger transcripts keep their pointer but are not parsed for a result. */
const TRANSCRIPT_BYTE_CAP = 64 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export interface ClaudeAgentTranscript {
  readonly path: string;
  readonly finalText: string | undefined;
  readonly model: string | undefined;
  readonly usage: {
    readonly totalTokens?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly toolCalls?: number;
    readonly durationMs?: number;
  };
}

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/**
 * Summarises one sub-agent transcript (`subagents/agent-<id>.jsonl`, which a background Agent's
 * output file links to). A message streams as several lines sharing one id, so usage counts the
 * last line of each message. Cache reads are reported apart from the total.
 */
export const summarizeClaudeAgentTranscript = (
  path: string,
  contents: string,
): ClaudeAgentTranscript => {
  const usageByMessage = new Map<string, Record<string, unknown>>();
  const toolUses = new Set<string>();
  let finalText: string | undefined;
  let model: string | undefined;
  let first: number | undefined;
  let last: number | undefined;
  for (const line of contents.split("\n")) {
    if (line.trim().length === 0) continue;
    const entry = record(Option.getOrUndefined(decodeLine(line)));
    if (entry === undefined) continue;
    const at = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    if (Number.isFinite(at)) {
      first ??= at;
      last = at;
    }
    if (entry.type !== "assistant") continue;
    const message = record(entry.message);
    if (message === undefined) continue;
    if (typeof message.model === "string" && message.model !== "<synthetic>") model = message.model;
    const usage = record(message.usage);
    const id = typeof message.id === "string" ? message.id : String(entry.uuid);
    if (usage !== undefined) usageByMessage.set(id, usage);
    if (!Array.isArray(message.content)) continue;
    const texts: string[] = [];
    for (const block of message.content) {
      const part = record(block);
      if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
      if (part?.type === "tool_use" && typeof part.id === "string") toolUses.add(part.id);
    }
    const text = texts.join("\n").trim();
    if (text.length > 0) finalText = text;
  }
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  for (const usage of usageByMessage.values()) {
    input += count(usage.input_tokens) + count(usage.cache_creation_input_tokens);
    output += count(usage.output_tokens);
    cacheRead += count(usage.cache_read_input_tokens);
  }
  const counted = usageByMessage.size > 0;
  return {
    path,
    finalText,
    model,
    usage: {
      ...(counted
        ? {
            totalTokens: input + output,
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
          }
        : {}),
      ...(toolUses.size > 0 ? { toolCalls: toolUses.size } : {}),
      ...(first !== undefined && last !== undefined ? { durationMs: last - first } : {}),
    },
  };
};

/** Claude's project folder name for a working directory. */
const claudeProjectSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/gu, "-");

/**
 * Finds `<config>/projects/<slug>/<session>/subagents/agent-<id>.jsonl`, trying the folder named
 * after `cwd` before scanning every project folder. Reads directories only.
 */
export const locateClaudeAgentTranscript = Effect.fn("AgentReceipts.locateClaudeTranscript")(
  function* (input: {
    readonly configDirs: ReadonlyArray<string>;
    readonly sessionId: string;
    readonly agentId: string;
    readonly cwd: string | undefined;
  }) {
    if (!SAFE_ID.test(input.agentId) || !SAFE_ID.test(input.sessionId)) return undefined;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false));
    const at = (projects: string, slug: string) =>
      path.join(projects, slug, input.sessionId, "subagents", `agent-${input.agentId}.jsonl`);
    for (const configDir of input.configDirs) {
      const projects = path.join(configDir, "projects");
      if (input.cwd !== undefined) {
        const guess = at(projects, claudeProjectSlug(input.cwd));
        if (yield* exists(guess)) return guess;
      }
      const slugs = yield* fs.readDirectory(projects).pipe(Effect.orElseSucceed(() => []));
      for (const slug of slugs) {
        if (!(yield* exists(path.join(projects, slug, input.sessionId)))) continue;
        const candidate = at(projects, slug);
        if (yield* exists(candidate)) return candidate;
      }
    }
    return undefined;
  },
);

export const readClaudeAgentTranscript = Effect.fn("AgentReceipts.readClaudeTranscript")(function* (
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* fs.stat(file);
  if (Number(info.size) > TRANSCRIPT_BYTE_CAP)
    return { path: file, finalText: undefined, model: undefined, usage: {} };
  return summarizeClaudeAgentTranscript(file, yield* fs.readFileString(file));
});
