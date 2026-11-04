// The implementation imports git and project setup, which reach the provider adapters; keeping
// the tag here lets ClaudeAdapterV2 depend on it without an import cycle.
import type { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const Receipt = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  sessionId: Schema.String,
  sourceCwd: Schema.String,
  worktreePath: Schema.String,
  branch: Schema.String,
  baseCommit: Schema.String,
  agentId: Schema.NullOr(Schema.String),
  completed: Schema.Boolean,
});
export type Receipt = typeof Receipt.Type;

export interface ClaudeWorktreeOwner {
  readonly threadId: ThreadId;
  readonly sessionId: string;
  readonly projectId: ProjectId;
}

export class ClaudeWorktreeError extends Schema.TaggedError<ClaudeWorktreeError>()(
  "ClaudeWorktreeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Loom could not ${this.operation} the Claude worktree.`;
  }
}

export class ClaudeWorktreeService extends Context.Service<
  ClaudeWorktreeService,
  {
    readonly create: (
      input: ClaudeWorktreeOwner & { readonly cwd: string; readonly name: string },
    ) => Effect.Effect<Receipt, ClaudeWorktreeError>;
    readonly agentState: (
      input: ClaudeWorktreeOwner & {
        readonly cwd: string;
        readonly agentId: string;
        readonly completed: boolean;
      },
    ) => Effect.Effect<void, ClaudeWorktreeError>;
    readonly environment: (input: {
      readonly cwd: string | null;
      readonly path?: string | undefined;
    }) => Effect.Effect<Record<string, string>, ClaudeWorktreeError>;
    readonly describe: (
      input: ClaudeWorktreeOwner & { readonly cwd: string },
    ) => Effect.Effect<string | null, ClaudeWorktreeError>;
    readonly remove: (
      input: ClaudeWorktreeOwner & { readonly worktreePath: string },
    ) => Effect.Effect<"removed" | "retained" | "unowned", ClaudeWorktreeError>;
    readonly sweep: (
      input: ClaudeWorktreeOwner & { readonly cwd?: string },
    ) => Effect.Effect<void, ClaudeWorktreeError>;
  }
>()("t3/provider/ClaudeWorktreeServiceTag/ClaudeWorktreeService") {}
