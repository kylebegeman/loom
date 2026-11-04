import type { HookCallback, Options } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";

import type { ClaudeWorktreeOwner, ClaudeWorktreeService } from "./ClaudeWorktreeServiceTag.ts";

export const claudeWorktreeHooks = Effect.fn("claudeWorktreeHooks")(function* (
  service: ClaudeWorktreeService["Service"],
  owner: ClaudeWorktreeOwner,
): Effect.fn.Return<NonNullable<Options["hooks"]>> {
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const describedAgents = new Set<string>();
  const create: HookCallback = async (input, _toolUseId, options) => {
    if (input.hook_event_name !== "WorktreeCreate") return {};
    const receipt = await runPromise(
      service.create({ ...owner, cwd: input.cwd, name: input.name }),
      options,
    );
    return {
      hookSpecificOutput: { hookEventName: "WorktreeCreate", worktreePath: receipt.worktreePath },
    };
  };
  const remove: HookCallback = async (input, _toolUseId, options) => {
    if (input.hook_event_name !== "WorktreeRemove") return {};
    const outcome = await runPromise(
      service.remove({ ...owner, worktreePath: input.worktree_path }),
      options,
    );
    if (outcome !== "removed")
      throw new Error(
        "Loom kept this worktree because it is unowned, has changes, or has not been integrated into its parent checkout.",
      );
    return {};
  };
  const start: HookCallback = async (input, _toolUseId, options) => {
    if (input.hook_event_name !== "SubagentStart") return {};
    await runPromise(
      service.agentState({ ...owner, cwd: input.cwd, agentId: input.agent_id, completed: false }),
      options,
    );
    const context = await runPromise(service.describe({ ...owner, cwd: input.cwd }), options);
    if (context !== null) describedAgents.add(input.agent_id);
    return context === null
      ? {}
      : { hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: context } };
  };
  // Some Claude versions announce SubagentStart before selecting the isolated cwd.
  const observe: HookCallback = async (input, _toolUseId, options) => {
    if (input.hook_event_name !== "PreToolUse" || input.agent_id === undefined) return {};
    await runPromise(
      service.agentState({ ...owner, cwd: input.cwd, agentId: input.agent_id, completed: false }),
      options,
    );
    if (describedAgents.has(input.agent_id)) return {};
    const context = await runPromise(service.describe({ ...owner, cwd: input.cwd }), options);
    if (context !== null) describedAgents.add(input.agent_id);
    return context === null
      ? {}
      : { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context } };
  };
  const stopAgent: HookCallback = async (input, _toolUseId, options) => {
    if (input.hook_event_name !== "SubagentStop") return {};
    await runPromise(
      service.agentState({ ...owner, cwd: input.cwd, agentId: input.agent_id, completed: true }),
      options,
    );
    return {};
  };
  const sweep: HookCallback = async (input, _toolUseId, options) => {
    if (input.agent_id !== undefined) return {};
    await runPromise(
      service.sweep({ ...owner, cwd: input.cwd }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Loom could not finish Claude worktree cleanup", {
            threadId: owner.threadId,
            cause,
          }),
        ),
      ),
      options,
    );
    return {};
  };
  return {
    WorktreeCreate: [{ hooks: [create] }],
    WorktreeRemove: [{ hooks: [remove] }],
    SubagentStart: [{ hooks: [start] }],
    PreToolUse: [{ hooks: [observe] }],
    SubagentStop: [{ hooks: [stopAgent] }],
    Stop: [{ hooks: [sweep] }],
    SessionEnd: [{ hooks: [sweep] }],
  };
});
