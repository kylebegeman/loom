import type {
  CommandIntent,
  IntentCommand,
  ProjectProfile,
  ProjectProfilePatch,
} from "@t3tools/contracts/fork";
export interface ProfileDraft {
  agentNotes?: string;
  bindings?: ProjectProfile["bindings"];
  commands?: Partial<Record<CommandIntent, IntentCommand | null>>;
  dailyTokens?: number | null;
  threadTokens?: number | null;
  schemaPath?: string;
  varlock?: "auto" | "never";
}
export function buildProfilePatch(
  profile: ProjectProfile,
  draft: ProfileDraft,
): ProjectProfilePatch {
  const patch: ProjectProfilePatch = {
    ...(draft.bindings === undefined ? {} : { bindings: draft.bindings }),
    ...(draft.agentNotes === undefined ? {} : { agentNotes: draft.agentNotes }),
    ...(draft.dailyTokens === undefined && draft.threadTokens === undefined
      ? {}
      : {
          budgets: {
            ...profile.budgets,
            ...(draft.dailyTokens === undefined ? {} : { dailyTokens: draft.dailyTokens }),
            ...(draft.threadTokens === undefined ? {} : { threadTokens: draft.threadTokens }),
          },
        }),
    ...(draft.schemaPath === undefined && draft.varlock === undefined
      ? {}
      : {
          env: {
            ...profile.env,
            ...(draft.schemaPath === undefined ? {} : { schemaPath: draft.schemaPath }),
            ...(draft.varlock === undefined ? {} : { varlock: draft.varlock }),
          },
        }),
  };
  if (!draft.commands) return patch;
  const commands = { ...profile.commands };
  for (const [intent, command] of Object.entries(draft.commands)) {
    if (command === null) delete commands[intent as CommandIntent];
    else commands[intent as CommandIntent] = command;
  }
  return { ...patch, commands };
}
export function mixedValue<A>(values: readonly A[]): { value: A | undefined; mixed: boolean } {
  if (!values.length) return { value: undefined, mixed: false };
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first)
    ? { value: values[0], mixed: false }
    : { value: undefined, mixed: true };
}
