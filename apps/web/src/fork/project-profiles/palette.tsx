import { KeyRoundIcon } from "lucide-react";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { COMMAND_INTENTS, type CommandIntent } from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import type { ForkCommandPaletteSource } from "../commandPalette/registry";
import { FEATURE, openEnv, profiles, requestProfileAction, useProfilesSupported } from "./state";
const noPermission = Atom.make(false);
export interface ProfilePaletteContext {
  readonly projectId: import("@t3tools/contracts").ProjectId;
  readonly intents: readonly CommandIntent[];
  readonly varlock: boolean;
  readonly canRun: boolean;
}
export function useProfilePaletteContext(
  threadRef: ScopedThreadRef | null,
): ProfilePaletteContext | null {
  const thread = useQuietThreadShell(threadRef);
  const supported = useProfilesSupported(
    threadRef?.environmentId ?? ("" as import("@t3tools/contracts").EnvironmentId),
  );
  const profile = useEnvironmentQuery(
    supported && threadRef && thread
      ? profiles.profile({
          environmentId: threadRef.environmentId,
          input: { projectId: thread.projectId },
        })
      : null,
  );
  const env = useEnvironmentQuery(
    supported && threadRef && thread
      ? profiles.envReport({
          environmentId: threadRef.environmentId,
          input: { projectId: thread.projectId, threadId: threadRef.threadId },
        })
      : null,
  );
  const canRun = useAtomValue(
    threadRef ? profiles.command.permissionAtom(threadRef.environmentId) : noPermission,
  );
  return supported && thread
    ? {
        projectId: thread.projectId,
        intents: COMMAND_INTENTS.filter((intent) => profile.data?.commands[intent]),
        varlock:
          profile.data?.env.varlock === "auto" &&
          env.data?.varlock._tag === "available" &&
          env.data.schema._tag === "ok",
        canRun,
      }
    : null;
}
export const projectProfilesPaletteSource: ForkCommandPaletteSource = {
  id: FEATURE,
  items: ({ activeThreadRef, loomFeatures, projectProfile }) => {
    if (!activeThreadRef || !loomFeatures.includes(FEATURE)) return [];
    const base = {
      kind: "action" as const,
      icon: <KeyRoundIcon className="size-4" />,
      description: "Project profile",
      searchTerms: ["env", "environment", "notes", "profile", "budget", "varlock"],
    };
    return [
      {
        ...base,
        value: "action:loom:project-profiles:open-env",
        title: "Open project env",
        run: async () => openEnv(activeThreadRef),
      },
      ...(projectProfile
        ? [
            {
              ...base,
              value: "action:loom:project-profiles:edit",
              title: "Edit project profile",
              searchTerms: [...base.searchTerms, "agent tools", "hardware", "reach", "sites"],
              run: async () =>
                requestProfileAction({
                  kind: "edit",
                  environmentId: activeThreadRef.environmentId,
                  projectId: projectProfile.projectId,
                }),
            },
          ]
        : []),
      ...(projectProfile?.varlock && projectProfile.canRun
        ? projectProfile.intents.map((intent) => ({
            ...base,
            value: `action:loom:project-profiles:run-${intent}`,
            title: `Run ${intent} with varlock`,
            run: async () =>
              requestProfileAction({ kind: "run", threadRef: activeThreadRef, intent }),
          }))
        : []),
    ];
  },
};
